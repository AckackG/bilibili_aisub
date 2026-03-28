(function initPageContextBridge() {
  const MESSAGE_TYPE = "PAGE_CONTEXT";
  const POLL_INTERVAL_MS = 1000;
  let lastPageUrl = "";
  let lastTitle = "";

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

  function sendPageContext() {
    const pageUrl = window.location.href;
    const title = sanitizeTitle(document.title);
    const videoId = extractVideoId(pageUrl);

    chrome.runtime.sendMessage(
      {
        type: MESSAGE_TYPE,
        payload: {
          pageUrl,
          title,
          videoId
        }
      },
      () => {
        void chrome.runtime?.lastError;
      }
    );
  }

  function refreshContextIfNeeded() {
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
  window.addEventListener("pageshow", refreshContextIfNeeded);
  setInterval(refreshContextIfNeeded, POLL_INTERVAL_MS);
})();
