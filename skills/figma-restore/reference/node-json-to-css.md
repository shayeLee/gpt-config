# node.json → CSS 映射详表

Figma REST API 返回的节点 JSON 字段与 CSS 属性的对应关系。

> **数据来源与权威性**：字段名取自 Figma REST API（`GET /v1/files/:key/nodes` 的 Node 类型）。本表是**人工整理的二手映射**，核心字段（layoutMode / padding / itemSpacing / cornerRadius / strokes / lineHeightPx / fills 等）已被真实 `node.json` 印证；遇到本表未覆盖或存疑的字段，**以官方 API 文档和本 skill 已保存的实际 `node.json` 为准**。
> **维护方式**：Figma API 核心字段多年稳定，按需增量维护即可——遇到新字段/新坑再补，不必主动追全。校验最可靠的办法是拿真实 `node.json` 对照本表。

---

## 布局（Auto Layout）

| 字段路径 / 条件 / 枚举 | CSS |
|---|---|
| `layoutMode === 'HORIZONTAL'` | `display: flex; flex-direction: row` |
| `layoutMode === 'VERTICAL'` | `display: flex; flex-direction: column` |
| `primaryAxisAlignItems === 'MIN'` | `justify-content: flex-start` |
| `primaryAxisAlignItems === 'CENTER'` | `justify-content: center` |
| `primaryAxisAlignItems === 'MAX'` | `justify-content: flex-end` |
| `primaryAxisAlignItems === 'SPACE_BETWEEN'` | `justify-content: space-between` |
| `counterAxisAlignItems === 'MIN'` | `align-items: flex-start` |
| `counterAxisAlignItems === 'CENTER'` | `align-items: center` |
| `counterAxisAlignItems === 'MAX'` | `align-items: flex-end` |
| `counterAxisAlignItems === 'BASELINE'` | `align-items: baseline` |
| `itemSpacing` | 间距：优先用 `margin`（`gap` 视浏览器兼容策略决定） |
| `paddingTop` / `paddingRight` / `paddingBottom` / `paddingLeft` | 对应 `padding-*` |
| `layoutSizingHorizontal === 'FILL'` | `flex: 1` 或 `width: 100%` |
| `layoutSizingHorizontal === 'HUG'` | `width: fit-content` |
| `layoutSizingHorizontal === 'FIXED'` | `width: <absoluteBoundingBox.width>` |

> **无 layoutMode（无自动布局）**：用 `absoluteBoundingBox` 差值做绝对/相对定位：
> `left = node.x - parent.x - parent.paddingLeft`

---

## 尺寸

```
宽：absoluteBoundingBox.width
高：absoluteBoundingBox.height
```

> ⚠️ `absoluteBoundingBox` 是节点在画布绝对坐标中的边界，用于布局、尺寸和间距计算。需要核对阴影、粗描边等超出常规边界的实际视觉范围时，读取 `absoluteRenderBounds`。不要根据 `strokeWeight` 自动增减 `absoluteBoundingBox` 的尺寸。

---

## 颜色 & 填充

```js
// 先过滤隐藏 fill（fill 可被单独隐藏，取色前必须排除）
const visibleSolidFills = (node.fills || []).filter(f => f.visible !== false && f.type === 'SOLID')
// 只有一项满足条件时才能直接使用；多项时按实际合成结果判断
const fill = visibleSolidFills.length === 1 ? visibleSolidFills[0] : null
const color = fill?.color  // {r, g, b} 各 0~1
// 最终透明度 = 节点 opacity × fill opacity（两者相乘）
const alpha = (node.opacity ?? 1) * (fill?.opacity ?? 1)

const hex = color && '#' + ['r','g','b'].map(k => Math.round(color[k] * 255).toString(16).padStart(2, '0')).join('')
// alpha < 1 时用 rgba(...)
```

> ⚠️ **`fills[0]` 未必是主色**：一个节点可叠多层 fill，且其中任意层可能 `visible:false`。多层时结合实际合成结果判断需要的颜色，不要默认取第一层。

| 字段路径 / 条件 / 枚举 | CSS |
|---|---|
| `fills[].type === 'SOLID'` | `background-color` / `color` / `border-color` |
| `fills[].type === 'GRADIENT_LINEAR'` | `background: linear-gradient(...)` |
| `fills[].type === 'IMAGE'` | 位图，走项目图片引用约定（`<img>` / `background-image`） |

---

## 文字

| 字段路径 / 条件 / 枚举 | CSS |
|---|---|
| `style.fontSize` | `font-size` |
| `style.fontWeight` | `font-weight` |
| `style.lineHeightPx` | `line-height`（绝对值）；`style.lineHeightUnit === 'PERCENT'` 时用 `style.lineHeightPercentFontSize / 100` |
| `style.letterSpacing` | `letter-spacing`（单位 px；`style.letterSpacingUnit === 'PERCENT'` 时 = value/1000 em） |
| `style.textAlignHorizontal` | `text-align`（LEFT/CENTER/RIGHT/JUSTIFIED） |
| `style.textDecoration` | `text-decoration`（UNDERLINE/STRIKETHROUGH） |
| `style.textCase` | `text-transform`（UPPER→uppercase / LOWER→lowercase） |
| `fills[]` 中 `type === 'SOLID' && visible !== false` 的 `color` | `color` |

---

## 边框 & 圆角

| 字段路径 / 条件 / 枚举 | CSS |
|---|---|
| `cornerRadius` | `border-radius` |
| `rectangleCornerRadii` | `border-radius: tl tr br bl`（四角不同时） |
| `strokes[]` 中 `type === 'SOLID'` 的 `color` + `strokeWeight` | `border: <strokeWeight>px solid <color>` |
| `strokeAlign === 'INSIDE'` | `border` + `box-sizing: border-box`；不占 border 槽时可用 `box-shadow: inset 0 0 0 <w>px <color>` |
| `strokeAlign === 'OUTSIDE'` | `outline` 或外层包裹 |

---

## 阴影

```js
// effects[].type === 'DROP_SHADOW'，先过滤 visible:false 的 effect（同 fill，可被单独隐藏）
// color 是 {r, g, b, a}——alpha 在 color.a 里，没有单独的 opacity 字段
const e = (node.effects || []).filter(x => x.visible !== false && x.type === 'DROP_SHADOW')[0]
const { offset: { x, y }, radius, spread = 0, color } = e
css = `box-shadow: ${x}px ${y}px ${radius}px ${spread}px rgba(${Math.round(color.r*255)},${Math.round(color.g*255)},${Math.round(color.b*255)},${color.a})`
```

`INNER_SHADOW` → `box-shadow: inset ...`

---

## 不透明度

| 字段路径 / 条件 / 枚举 | CSS |
|---|---|
| `opacity` | `opacity`（节点整体；fills 里也有各自 opacity） |

---

## 定位（无 Auto Layout 时）

```
left   = node.absoluteBoundingBox.x - parent.absoluteBoundingBox.x
top    = node.absoluteBoundingBox.y - parent.absoluteBoundingBox.y
right  = (parent.x + parent.width) - (node.x + node.width)
bottom = (parent.y + parent.height) - (node.y + node.height)
```

父容器用 `position: relative`，子节点 `position: absolute`。

---
