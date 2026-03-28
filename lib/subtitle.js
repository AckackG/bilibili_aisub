const INVALID_FILE_NAME_PATTERN = /[<>:"/\\|?*\u0000-\u001f]/g;
const BILIBILI_TITLE_SUFFIX_PATTERN = /\s*[-_]\s*哔哩哔哩(?:_bilibili)?\s*$/i;

export function extractVideoIdFromUrl(url) {
  if (typeof url !== "string" || url.length === 0) {
    return "";
  }

  const match = url.match(/\/video\/([^/?#]+)/i);
  return match ? match[1] : "";
}

export function isBilibiliVideoUrl(url) {
  return extractVideoIdFromUrl(url) !== "";
}

export function normalizeAiSubtitleUrl(url) {
  if (typeof url !== "string" || url.length === 0) {
    return "";
  }

  try {
    const parsedUrl = new URL(url);
    return `${parsedUrl.origin}${parsedUrl.pathname}`;
  } catch {
    return url;
  }
}

export function sanitizePageTitle(title) {
  if (typeof title !== "string") {
    return "";
  }

  return title.replace(BILIBILI_TITLE_SUFFIX_PATTERN, "").trim();
}

export function sanitizeFileName(input, fallback = "subtitle") {
  const raw = typeof input === "string" ? input : "";
  const sanitized = raw
    .replace(INVALID_FILE_NAME_PATTERN, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();

  return sanitized || fallback;
}

export function countNonEmptySubtitleLines(payload) {
  if (!payload || !Array.isArray(payload.body)) {
    return 0;
  }

  return payload.body.reduce((count, item) => {
    const text = typeof item?.content === "string" ? item.content.trim() : "";
    return text ? count + 1 : count;
  }, 0);
}

export function isValidAiSubtitlePayload(payload) {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  if (payload.type !== "AIsubtitle") {
    return false;
  }

  if (!Array.isArray(payload.body)) {
    return false;
  }

  return countNonEmptySubtitleLines(payload) > 0;
}

export function formatSrtTime(seconds) {
  const safeSeconds = Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
  const totalMilliseconds = Math.round(safeSeconds * 1000);
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;

  return [
    String(hours).padStart(2, "0"),
    String(minutes).padStart(2, "0"),
    String(secs).padStart(2, "0")
  ].join(":") + `,${String(milliseconds).padStart(3, "0")}`;
}

export function convertAiSubtitleJsonToSrt(payload) {
  if (!payload || !Array.isArray(payload.body)) {
    return "";
  }

  const blocks = [];
  let index = 1;

  for (const item of payload.body) {
    const rawContent = typeof item?.content === "string" ? item.content.replace(/\r\n/g, "\n") : "";
    const content = rawContent.trim();
    const from = Number(item?.from);
    const to = Number(item?.to);

    if (!content) {
      continue;
    }

    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
      continue;
    }

    blocks.push([
      String(index),
      `${formatSrtTime(from)} --> ${formatSrtTime(to)}`,
      content
    ].join("\n"));
    index += 1;
  }

  return blocks.join("\n\n");
}

function formatPlainTextBucketLabel(bucketIndex, bucketMinutes) {
  const startMinute = bucketIndex * bucketMinutes;
  const endMinute = startMinute + bucketMinutes;

  if (startMinute === 0) {
    return `0~${endMinute}min`;
  }

  return `${startMinute}min~${endMinute}min`;
}

export function convertAiSubtitleJsonToPlainText(payload, bucketMinutes = 2) {
  if (!payload || !Array.isArray(payload.body)) {
    return "";
  }

  const safeBucketMinutes = Number.isFinite(bucketMinutes) && bucketMinutes > 0
    ? bucketMinutes
    : 2;
  const bucketSeconds = safeBucketMinutes * 60;
  const buckets = new Map();

  for (const item of payload.body) {
    const rawContent = typeof item?.content === "string" ? item.content.replace(/\r\n/g, "\n") : "";
    const content = rawContent.trim();
    const from = Number(item?.from);

    if (!content) {
      continue;
    }

    if (!Number.isFinite(from) || from < 0) {
      continue;
    }

    const bucketIndex = Math.floor(from / bucketSeconds);
    if (!buckets.has(bucketIndex)) {
      buckets.set(bucketIndex, []);
    }

    buckets.get(bucketIndex).push(content);
  }

  const blocks = [...buckets.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([bucketIndex, lines]) => {
      if (!Array.isArray(lines) || lines.length === 0) {
        return "";
      }

      return [
        formatPlainTextBucketLabel(bucketIndex, safeBucketMinutes),
        lines.join("\n")
      ].join("\n");
    })
    .filter(Boolean);

  return blocks.join("\n\n");
}

export function buildDownloadBaseName({ videoId = "", title = "", lang = "" }) {
  const identity = sanitizeFileName(videoId, "") || sanitizeFileName(title, "video");
  const language = sanitizeFileName(lang || "unknown", "unknown");
  return `bilibili-ai-subtitle_${identity}_${language}`;
}
