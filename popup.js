const MESSAGE_TYPES = {
  GET_TAB_SUBTITLES: "GET_TAB_SUBTITLES",
  DOWNLOAD_SUBTITLE: "DOWNLOAD_SUBTITLE"
};
const REFRESH_INTERVAL_MS = 1000;

const pageMetaElement = document.getElementById("page-meta");
const statusElement = document.getElementById("status");
const subtitleListElement = document.getElementById("subtitle-list");

let activeTabId = null;
let refreshTimer = null;
let downloadingSourceKey = "";

function isBilibiliVideoUrl(url) {
  return typeof url === "string" && /https:\/\/www\.bilibili\.com\/video\/[^/?#]+/i.test(url);
}

function languageName(lang) {
  const normalized = typeof lang === "string" ? lang.toLowerCase() : "";
  const mapping = {
    zh: "中文",
    "zh-cn": "简体中文",
    "zh-hans": "简体中文",
    "zh-tw": "繁體中文",
    "zh-hant": "繁體中文",
    en: "English",
    ja: "日本語",
    jp: "日本語",
    ko: "한국어"
  };

  return mapping[normalized] || lang || "未知语言";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function setStatus(message, tone = "neutral") {
  statusElement.hidden = false;
  statusElement.dataset.tone = tone;
  statusElement.textContent = message;
}

function hideStatus() {
  statusElement.hidden = true;
  statusElement.dataset.tone = "ready";
  statusElement.textContent = "";
}

function renderPageMeta(page, tab) {
  const title = page?.title || tab?.title || "";
  const videoId = page?.videoId || "";
  const pageUrl = page?.pageUrl || tab?.url || "";

  if (!title && !videoId && !pageUrl) {
    pageMetaElement.hidden = true;
    pageMetaElement.innerHTML = "";
    return;
  }

  pageMetaElement.hidden = false;
  pageMetaElement.innerHTML = `
    <p class="page-meta__title">${escapeHtml(title || videoId || "当前视频")}</p>
    <p class="page-meta__sub">${escapeHtml(videoId || pageUrl)}</p>
  `;
}

function renderSubtitleList(subtitles) {
  subtitleListElement.innerHTML = "";

  for (const subtitle of subtitles) {
    const item = document.createElement("li");
    item.className = "subtitle-item";

    const info = document.createElement("div");
    const button = document.createElement("button");
    button.className = "subtitle-item__button";
    button.type = "button";
    button.dataset.sourceKey = subtitle.sourceKey;
    button.textContent = downloadingSourceKey === subtitle.sourceKey ? "下载中..." : "下载 ZIP";
    button.disabled = downloadingSourceKey === subtitle.sourceKey;

    info.innerHTML = `
      <p class="subtitle-item__lang">${escapeHtml(languageName(subtitle.lang))}</p>
      <p class="subtitle-item__meta">${escapeHtml(subtitle.lang)} · ${subtitle.lineCount} 条有效字幕</p>
    `;

    button.addEventListener("click", () => {
      void downloadSubtitle(subtitle.sourceKey);
    });

    item.append(info, button);
    subtitleListElement.append(item);
  }
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return tabs[0] || null;
}

async function requestTabSubtitles(tabId) {
  return chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.GET_TAB_SUBTITLES,
    payload: { tabId }
  });
}

async function refreshPopup() {
  const tab = await getActiveTab();
  activeTabId = tab?.id ?? null;

  if (!tab || !isBilibiliVideoUrl(tab.url)) {
    renderPageMeta(null, tab);
    subtitleListElement.innerHTML = "";
    setStatus("当前标签页不是 Bilibili 视频页。", "error");
    return;
  }

  const response = await requestTabSubtitles(tab.id);
  if (!response?.ok) {
    renderPageMeta(null, tab);
    subtitleListElement.innerHTML = "";
    setStatus(response?.error || "读取字幕状态失败。", "error");
    return;
  }

  const { page, subtitles, pendingCount } = response.data;
  renderPageMeta(page, response.tab);

  if (subtitles.length > 0) {
    hideStatus();
    renderSubtitleList(subtitles);
    return;
  }

  subtitleListElement.innerHTML = "";
  if (pendingCount > 0) {
    setStatus("已捕获字幕请求，正在验证内容，稍等一秒。");
    return;
  }

  setStatus("还没探测到 AI 字幕。先在视频播放器里打开字幕，让页面真正发出字幕请求。");
}

async function downloadSubtitle(sourceKey) {
  if (!activeTabId || downloadingSourceKey) {
    return;
  }

  downloadingSourceKey = sourceKey;
  await refreshPopup();

  try {
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.DOWNLOAD_SUBTITLE,
      payload: {
        tabId: activeTabId,
        sourceKey
      }
    });

    if (!response?.ok) {
      setStatus(response?.error || "下载失败。", "error");
      return;
    }

    setStatus("下载已开始，ZIP 内含 JSON 和 SRT。");
  } catch (error) {
    console.error("Failed to start download:", error);
    setStatus("下载失败，后台脚本可能已失效。", "error");
  } finally {
    downloadingSourceKey = "";
    await refreshPopup();
  }
}

async function bootstrap() {
  await refreshPopup();
  refreshTimer = window.setInterval(() => {
    void refreshPopup();
  }, REFRESH_INTERVAL_MS);
}

window.addEventListener("unload", () => {
  if (refreshTimer !== null) {
    window.clearInterval(refreshTimer);
  }
});

void bootstrap();
