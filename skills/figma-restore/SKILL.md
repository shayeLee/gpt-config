---
name: figma-restore
description: 获取 Figma 节点数据并按设计稿还原项目 UI
argument-hint: "<Figma 链接> [第二条链接 ...]"
---

# Figma 还原 UI

## 约束

- 确认或询问用户：设计稿宽度与单位换算、资源目录与引用方式、文案接入方式（现有 i18n key/组件或直接文案）及其换行、溢出和截断策略、浏览器兼容策略。
- 在用户指定范围内，以 Figma 节点数据中的布局、尺寸、填充与颜色、文字与文字样式、边框与圆角、阴影、不透明度、定位和图标/位图资源为准（详见 [node-json-to-css.md](reference/node-json-to-css.md)）。若改动会改变业务语义、交互或组件边界，说明冲突并先取得确认。
- 使用项目根 `.env.figma` 中的 `FIGMA_TOKEN` 访问 REST API。不要索取或展示 token；将 `.env.figma` 加入 `.gitignore`。

## 取数

从目标项目工作目录运行。`<skill-dir>` 是 Codex 当前 skill catalog 提供的本 skill 绝对目录。

```bash
node "<skill-dir>/scripts/figma-fetch.mjs" \
  "https://www.figma.com/design/<fileKey>/...?node-id=2004-2682" \
  ["第二条链接" ...]
```

- 脚本解析链接中的 `fileKey` 与 `node-id`，产物写入 `<cwd>/.figma/<fileKey>/<nodeId-with-dashes>/`：`node.json`、`report.json`、尽力下载的 `render@2x.png`、`assets/` 和 `icons/`。
- `nodes` 失败或没有目标 document 时以非零退出；渲染图、位图、SVG 失败时继续，并在 `report.json` 写入 `file:null`、`target`、`note`。
- 每次 fetch 都会清空该节点缓存目录；将 `.figma/` 加入 `.gitignore`。

### 资源与回退

- `report.json` 列出位图、SVG 图标和文本节点；资源路径以各条目的 `target` 为准。位图来自 IMAGE fill 或 PNG/JPG/WebP 导出；图标节点导出 SVG，以英文语义名命名；重名才追加节点 ID。
- 无法获取 `node.json` 时，手动导出节点的 2x PNG 并保存为 `render@2x.png`，作为人工还原与核对的回退；截图无法量化的值应标为估值，或仅就必要项询问用户。
- 已获取 `node.json`、但 `report.json` 中 SVG 或位图的 `file` 为 `null` 时，按该条目的 `target` 手动导出。
- 取证遍历时跳过 `visible === false` 的整棵子树。

## 取证与实现

- 尺寸与间距从 `absoluteBoundingBox` 和父节点 padding 计算；不要凭渲染图估量可取证的值。
- 详细字段到 CSS 的映射见 [reference/node-json-to-css.md](reference/node-json-to-css.md)。
- 还原时，按项目约定将需要的 `report.json` 资源复制到正式资源目录并引用。
- 沿用项目的单位换算、资源引用、i18n 与浏览器兼容策略。

## 验证与交付

- 有 `node.json` 时，直接读取它和 `report.json` 对照实现；不要为验证重跑 fetch。没有 `node.json` 时，使用 `render@2x.png` 做人工核对。
- 按项目约定跑相关检查。失败时区分本次引入的问题和既有失败；没有自动化检查时，运行构建或类型检查。
- 输出：已还原内容、待人工视觉核对项、i18n 待办和任何估值或未获取资源。
