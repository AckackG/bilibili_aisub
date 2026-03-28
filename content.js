(function initPageContextBridge() {
  const MESSAGE_TYPE = "PAGE_CONTEXT";
  const POLL_INTERVAL_MS = 1000;
  let lastPageUrl = "";
  let lastTitle = "";
  let isDisposed = false;
  let pollTimer = null;

  function extractVideoId(url) {
    if (typeof url !== "string") {
      return "";
    }

    const match = url.match(/\/video\/([^/?#]+)/i);
    return match ? match[1] : "";
  }

  function sanitizeTitle(title) {
    if (typeof title !== "string") {
      return "";
    }

    return title.replace(/\s*[-_]\s*哔哩哔哩(?:_bilibili)?\s*$/i, "").trim();
  }

  function isExtensionContextInvalidated(error) {
    if (!error) {
      return false;
    }

    const message = typeof error?.message === "string" ? error.message : String(error);
    return /Extension context invalidated/i.test(message);
  }

  function disposeBridge() {
    if (isDisposed) {
      return;
    }

    isDisposed = true;
    window.removeEventListener("pageshow", refreshContextIfNeeded);

    if (pollTimer !== null) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function handleRuntimeFailure(error) {
    if (!isExtensionContextInvalidated(error)) {
      return false;
    }

    disposeBridge();
    return true;
  }

  function getRuntime() {
    try {
      return chrome?.runtime ?? null;
    } catch {
      return null;
    }
  }

  function sendPageContext() {
    if (isDisposed) {
      return;
    }

    const pageUrl = window.location.href;
    const title = sanitizeTitle(document.title);
    const videoId = extractVideoId(pageUrl);
    const runtime = getRuntime();

    if (!runtime?.sendMessage) {
      disposeBridge();
      return;
    }

    try {
      runtime.sendMessage(
        {
          type: MESSAGE_TYPE,
          payload: {
            pageUrl,
            title,
            videoId
          }
        },
        () => {
          if (handleRuntimeFailure(runtime.lastError)) {
            return;
          }

          void runtime.lastError;
        }
      );
    } catch (error) {
      if (handleRuntimeFailure(error)) {
        return;
      }

      console.warn("Failed to send page context:", error);
    }
  }

  function refreshContextIfNeeded() {
    if (isDisposed) {
      return;
    }

    const currentPageUrl = window.location.href;
    const currentTitle = sanitizeTitle(document.title);

    if (currentPageUrl === lastPageUrl && currentTitle === lastTitle) {
      return;
    }

    lastPageUrl = currentPageUrl;
    lastTitle = currentTitle;
    sendPageContext();
  }

  refreshContextIfNeeded();
  if (isDisposed) {
    return;
  }

  window.addEventListener("pageshow", refreshContextIfNeeded);
  pollTimer = window.setInterval(refreshContextIfNeeded, POLL_INTERVAL_MS);
})();
