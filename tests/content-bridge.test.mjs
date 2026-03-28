import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const contentScriptSource = await readFile(new URL("../content.js", import.meta.url), "utf8");

function createHarness(options = {}) {
  const sendCalls = [];
  const clearedIntervals = [];
  const listeners = new Map();
  const document = {
    title: options.title ?? "Test Video - 哔哩哔哩"
  };
  const location = {
    href: options.href ?? "https://www.bilibili.com/video/BV1test123"
  };
  let intervalId = 0;
  let intervalHandler = null;

  const runtime = {
    sendMessage: (message, callback) => {
      sendCalls.push(message);
      return options.sendMessage(message, callback, runtime);
    }
  };

  Object.defineProperty(runtime, "lastError", {
    enumerable: true,
    configurable: true,
    get() {
      return options.getLastError ? options.getLastError() : null;
    }
  });

  const window = {
    location,
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) {
        listeners.delete(type);
      }
    },
    setInterval(handler) {
      intervalId += 1;
      intervalHandler = handler;
      return intervalId;
    },
    clearInterval(id) {
      clearedIntervals.push(id);
      if (id === intervalId) {
        intervalHandler = null;
      }
    }
  };

  const context = {
    chrome: { runtime },
    console: {
      warn: () => {},
      error: () => {},
      log: () => {}
    },
    document,
    window
  };

  context.globalThis = context;

  vm.createContext(context);
  vm.runInContext(contentScriptSource, context);

  return {
    clearedIntervals,
    document,
    listeners,
    location,
    sendCalls,
    tickInterval() {
      if (typeof intervalHandler === "function") {
        intervalHandler();
      }
    }
  };
}

test("content bridge stops immediately when extension context is already invalidated", () => {
  const harness = createHarness({
    sendMessage() {
      throw new Error("Extension context invalidated.");
    }
  });

  assert.equal(harness.sendCalls.length, 1);
  assert.equal(harness.listeners.has("pageshow"), false);
  assert.deepEqual(harness.clearedIntervals, []);
});

test("content bridge clears polling after runtime becomes invalidated later", () => {
  let callCount = 0;
  const harness = createHarness({
    sendMessage(message, callback) {
      callCount += 1;
      if (callCount === 1) {
        callback();
        return undefined;
      }

      throw new Error("Extension context invalidated.");
    }
  });

  assert.equal(harness.listeners.has("pageshow"), true);
  assert.equal(harness.sendCalls.length, 1);

  harness.document.title = "Updated Title - 哔哩哔哩";
  harness.tickInterval();

  assert.equal(harness.sendCalls.length, 2);
  assert.equal(harness.listeners.has("pageshow"), false);
  assert.deepEqual(harness.clearedIntervals, [1]);
});
