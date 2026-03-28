import {
  buildDownloadBaseName,
  convertAiSubtitleJsonToSrt,
  countNonEmptySubtitleLines,
  extractVideoIdFromUrl,
  isBilibiliVideoUrl,
  isValidAiSubtitlePayload,
  normalizeAiSubtitleUrl,
  sanitizeFileName,
  sanitizePageTitle
} from "./lib/subtitle.js";
import { blobToDataUrl } from "./lib/data-url.js";
import { createStoredZip } from "./lib/zip.js";

const AI_SUBTITLE_URL_FILTER = {
  urls: ["*://aisubtitle.hdslb.com/bfs/ai_subtitle/*"]
};
const BADGE_COLOR = "#d93025";
const MESSAGE_TYPES = {
  PAGE_CONTEXT: "PAGE_CONTEXT",
  GET_TAB_SUBTITLES: "GET_TAB_SUBTITLES",
  DOWNLOAD_SUBTITLE: "DOWNLOAD_SUBTITLE"
};

const tabStates = new Map();

function ensureTabState(tabId) {
  if (!tabStates.has(tabId)) {
    tabStates.set(tabId, {
      pageUrl: "",
      videoId: "",
      title: "",
      revision: 0,
      subtitles: new Map()
    });
  }

  return tabStates.get(tabId);
}

function getReadySubtitleCount(tabState) {
  let count = 0;

  for (const entry of tabState.subtitles.values()) {
    if (entry.status === "ready") {
      count += 1;
    }
  }

  return count;
}

function getPendingSubtitleCount(tabState) {
  let count = 0;

  for (const entry of tabState.subtitles.values()) {
    if (entry.status === "pending") {
      count += 1;
    }
  }

  return count;
}

async function updateBadge(tabId) {
  const tabState = tabStates.get(tabId);
  const readyCount = tabState ? getReadySubtitleCount(tabState) : 0;
  const badgeText = readyCount > 0 ? String(Math.min(readyCount, 99)) : "";
  const title = readyCount > 0
    ? `已探测到 ${readyCount} 个 AI 字幕`
    : "未探测到 AI 字幕";

  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR });
    await chrome.action.setBadgeText({ tabId, text: badgeText });
    await chrome.action.setTitle({ tabId, title });
  } catch {
    // Tab may already be gone. Ignore badge failures.
  }
}

async function clearTabState(tabId) {
  tabStates.delete(tabId);
  await updateBadge(tabId);
}

async function resetTabStateForUrl(tabId, pageUrl, title = "") {
  if (!isBilibiliVideoUrl(pageUrl)) {
    await clearTabState(tabId);
    return;
  }

  const tabState = ensureTabState(tabId);
  tabState.pageUrl = pageUrl;
  tabState.videoId = extractVideoIdFromUrl(pageUrl);
  tabState.title = sanitizePageTitle(title) || tabState.title;
  tabState.revision += 1;
  tabState.subtitles.clear();
  await updateBadge(tabId);
}

async function mergePageContext(tabId, payload) {
  const pageUrl = typeof payload?.pageUrl === "string" ? payload.pageUrl : "";
  const title = sanitizePageTitle(payload?.title);
  const incomingVideoId = typeof payload?.videoId === "string" ? payload.videoId : "";

  if (!isBilibiliVideoUrl(pageUrl)) {
    await clearTabState(tabId);
    return;
  }

  const tabState = ensureTabState(tabId);
  if (tabState.pageUrl && tabState.pageUrl !== pageUrl) {
    await resetTabStateForUrl(tabId, pageUrl, title);
    return;
  }

  tabState.pageUrl = pageUrl;
  tabState.videoId = incomingVideoId || extractVideoIdFromUrl(pageUrl);
  if (title) {
    tabState.title = title;
  }
}

async function getTabInfo(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

async function fetchSubtitleJson(requestUrl) {
  const response = await fetch(requestUrl, {
    method: "GET",
    credentials: "omit",
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Subtitle request failed: ${response.status}`);
  }

  return response.json();
}

async function refreshSubtitleEntry(tabId, requestUrl, pageUrl = "") {
  const tabState = ensureTabState(tabId);
  const sourceKey = normalizeAiSubtitleUrl(requestUrl);
  const currentPageUrl = pageUrl || tabState.pageUrl;
  const revision = tabState.revision;
  const existingEntry = tabState.subtitles.get(sourceKey);

  if (existingEntry?.status === "pending" && existingEntry.requestUrl === requestUrl) {
    return;
  }

  if (existingEntry?.status === "ready" && existingEntry.requestUrl === requestUrl) {
    existingEntry.updatedAt = Date.now();
    return;
  }

  tabState.subtitles.set(sourceKey, {
    sourceKey,
    requestUrl,
    lang: existingEntry?.lang || "",
    status: "pending",
    updatedAt: Date.now(),
    lineCount: 0
  });

  try {
    const payload = await fetchSubtitleJson(requestUrl);
    if (!isValidAiSubtitlePayload(payload)) {
      throw new Error("Invalid AI subtitle payload.");
    }

    const liveState = tabStates.get(tabId);
    if (!liveState || liveState.revision !== revision) {
      return;
    }

    liveState.subtitles.set(sourceKey, {
      sourceKey,
      requestUrl,
      lang: typeof payload.lang === "string" && payload.lang.trim() ? payload.lang.trim() : "unknown",
      status: "ready",
      updatedAt: Date.now(),
      lineCount: countNonEmptySubtitleLines(payload),
      pageUrl: currentPageUrl
    });

    await updateBadge(tabId);
  } catch (error) {
    const liveState = tabStates.get(tabId);
    if (!liveState || liveState.revision !== revision) {
      return;
    }

    liveState.subtitles.delete(sourceKey);
    await updateBadge(tabId);
    console.warn("Failed to validate AI subtitle request:", error);
  }
}

async function handleAiSubtitleRequest(details) {
  if (!Number.isInteger(details.tabId) || details.tabId < 0) {
    return;
  }

  const tab = await getTabInfo(details.tabId);
  const pageUrl = details.documentUrl || tab?.url || "";
  const pageTitle = sanitizePageTitle(tab?.title || "");

  if (!isBilibiliVideoUrl(pageUrl)) {
    return;
  }

  await mergePageContext(details.tabId, {
    pageUrl,
    title: pageTitle,
    videoId: extractVideoIdFromUrl(pageUrl)
  });
  await refreshSubtitleEntry(details.tabId, details.url, pageUrl);
}

function serializeTabState(tabId) {
  const tabState = tabStates.get(tabId);
  if (!tabState) {
    return {
      page: null,
      subtitles: [],
      pendingCount: 0
    };
  }

  const subtitles = [...tabState.subtitles.values()]
    .filter((entry) => entry.status === "ready")
    .sort((left, right) => left.lang.localeCompare(right.lang) || right.updatedAt - left.updatedAt)
    .map((entry) => ({
      sourceKey: entry.sourceKey,
      lang: entry.lang,
      lineCount: entry.lineCount,
      updatedAt: entry.updatedAt
    }));

  return {
    page: {
      pageUrl: tabState.pageUrl,
      videoId: tabState.videoId,
      title: tabState.title
    },
    subtitles,
    pendingCount: getPendingSubtitleCount(tabState)
  };
}

function createDownloadFiles(payload, baseName) {
  return [
    {
      name: `${baseName}.json`,
      content: JSON.stringify(payload, null, 2)
    },
    {
      name: `${baseName}.srt`,
      content: convertAiSubtitleJsonToSrt(payload)
    }
  ];
}

async function handleGetTabSubtitles(message) {
  const tabId = Number(message?.payload?.tabId);
  if (!Number.isInteger(tabId)) {
    return {
      ok: false,
      error: "Invalid tab id."
    };
  }

  const tab = await getTabInfo(tabId);
  return {
    ok: true,
    tab: tab ? { id: tab.id, url: tab.url || "", title: sanitizePageTitle(tab.title || "") } : null,
    data: serializeTabState(tabId)
  };
}

async function handleDownloadSubtitle(message) {
  const tabId = Number(message?.payload?.tabId);
  const sourceKey = typeof message?.payload?.sourceKey === "string" ? message.payload.sourceKey : "";

  if (!Number.isInteger(tabId) || !sourceKey) {
    return {
      ok: false,
      error: "缺少下载参数。"
    };
  }

  const tabState = tabStates.get(tabId);
  const entry = tabState?.subtitles.get(sourceKey);
  if (!tabState || !entry || entry.status !== "ready") {
    return {
      ok: false,
      error: "当前字幕已失效，请重新打开字幕后再试。"
    };
  }

  try {
    const payload = await fetchSubtitleJson(entry.requestUrl);
    if (!isValidAiSubtitlePayload(payload)) {
      throw new Error("Invalid AI subtitle payload.");
    }

    const baseName = sanitizeFileName(
      buildDownloadBaseName({
        videoId: tabState.videoId,
        title: tabState.title,
        lang: typeof payload.lang === "string" ? payload.lang : entry.lang
      }),
      "bilibili-ai-subtitle"
    );
    const files = createDownloadFiles(payload, baseName);
    const zipBlob = createStoredZip(files);
    const downloadUrl = await blobToDataUrl(zipBlob);

    await chrome.downloads.download({
      url: downloadUrl,
      filename: `${baseName}.zip`,
      saveAs: false
    });

    return { ok: true };
  } catch (error) {
    console.error("Failed to download subtitle ZIP:", error);
    return {
      ok: false,
      error: "下载失败，字幕链接可能已过期。"
    };
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
});

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    void handleAiSubtitleRequest(details);
  },
  AI_SUBTITLE_URL_FILTER
);

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId !== 0) {
    return;
  }

  void resetTabStateForUrl(details.tabId, details.url);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (typeof changeInfo.url === "string") {
    void resetTabStateForUrl(tabId, changeInfo.url, tab.title || "");
    return;
  }

  if (changeInfo.status === "complete" && typeof tab?.url === "string" && isBilibiliVideoUrl(tab.url)) {
    void mergePageContext(tabId, {
      pageUrl: tab.url,
      title: tab.title || "",
      videoId: extractVideoIdFromUrl(tab.url)
    });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void clearTabState(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = message?.type;
  if (type === MESSAGE_TYPES.PAGE_CONTEXT) {
    const tabId = sender?.tab?.id;
    if (Number.isInteger(tabId)) {
      void mergePageContext(tabId, message.payload);
    }

    sendResponse({ ok: true });
    return false;
  }

  if (type === MESSAGE_TYPES.GET_TAB_SUBTITLES) {
    void handleGetTabSubtitles(message).then(sendResponse);
    return true;
  }

  if (type === MESSAGE_TYPES.DOWNLOAD_SUBTITLE) {
    void handleDownloadSubtitle(message).then(sendResponse);
    return true;
  }

  sendResponse({ ok: false, error: "Unsupported message type." });
  return false;
});
