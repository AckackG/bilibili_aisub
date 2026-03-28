# Bilibili AI 字幕下载插件

一个本地载入的 Chrome Manifest V3 插件。

功能：

- 监听 `https://www.bilibili.com/video/*` 页面里实际触发过的 AI 字幕请求
- 探测到有效字幕后，在扩展图标上显示红色角标
- 点击扩展图标后按语言列出可下载字幕
- 每次下载一个 ZIP，内含原始 JSON 和转换后的 SRT

## 本地载入

1. 打开 `chrome://extensions/`
2. 开启右上角“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择本仓库目录

## 使用方式

1. 打开一个 `https://www.bilibili.com/video/*` 视频页
2. 在播放器里开启字幕，让页面真正发起 AI 字幕请求
3. 看到扩展图标出现红色角标后，点击图标
4. 在弹窗中选择语言并下载 ZIP

## 开发检查

```bash
npm run check
npm test
```
