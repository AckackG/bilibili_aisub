import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDownloadBaseName,
  convertAiSubtitleJsonToPlainText,
  convertAiSubtitleJsonToSrt,
  formatSrtTime,
  normalizeAiSubtitleUrl
} from "../lib/subtitle.js";
import { blobToDataUrl } from "../lib/data-url.js";
import { createStoredZip } from "../lib/zip.js";

test("formatSrtTime formats seconds to SRT timestamp", () => {
  assert.equal(formatSrtTime(3661.275), "01:01:01,275");
});

test("convertAiSubtitleJsonToSrt skips empty content and keeps order", () => {
  const payload = {
    type: "AIsubtitle",
    body: [
      { from: 1.2, to: 2.3, content: "第一句" },
      { from: 3, to: 4, content: "   " },
      { from: 5, to: 6.5, content: "第二句" }
    ]
  };

  assert.equal(
    convertAiSubtitleJsonToSrt(payload),
    [
      "1",
      "00:00:01,200 --> 00:00:02,300",
      "第一句",
      "",
      "2",
      "00:00:05,000 --> 00:00:06,500",
      "第二句"
    ].join("\n")
  );
});

test("convertAiSubtitleJsonToPlainText groups lines into 2-minute buckets and skips empty buckets", () => {
  const payload = {
    type: "AIsubtitle",
    body: [
      { from: 1.2, to: 2.3, content: "第一句" },
      { from: 50, to: 55, content: "第二句？" },
      { from: 121, to: 123, content: "第三句" },
      { from: 240.5, to: 241, content: "第四句" },
      { from: 260, to: 261, content: "   " }
    ]
  };

  assert.equal(
    convertAiSubtitleJsonToPlainText(payload),
    [
      "0~2min",
      "第一句。第二句？",
      "",
      "2min~4min",
      "第三句。",
      "",
      "4min~6min",
      "第四句。"
    ].join("\n")
  );
});

test("normalizeAiSubtitleUrl strips query string for dedupe", () => {
  const url = "https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/example?auth_key=abc&foo=bar";
  assert.equal(
    normalizeAiSubtitleUrl(url),
    "https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/example"
  );
});

test("buildDownloadBaseName prefers video id and language", () => {
  assert.equal(
    buildDownloadBaseName({
      videoId: "BV1abc123",
      title: "这是标题",
      lang: "zh"
    }),
    "bilibili-ai-subtitle_BV1abc123_zh"
  );
});

test("createStoredZip returns a ZIP blob with PK header", async () => {
  const blob = createStoredZip([
    { name: "subtitle.json", content: "{\"ok\":true}" },
    { name: "subtitle.srt", content: "1\n00:00:00,000 --> 00:00:01,000\n你好" }
  ]);

  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.equal(blob.type, "application/zip");
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  assert.ok(bytes.length > 100);
});

test("blobToDataUrl converts zip blob to base64 data URL", async () => {
  const blob = createStoredZip([
    { name: "subtitle.json", content: "{\"ok\":true}" }
  ]);

  const dataUrl = await blobToDataUrl(blob);
  assert.match(dataUrl, /^data:application\/zip;base64,/);
});
