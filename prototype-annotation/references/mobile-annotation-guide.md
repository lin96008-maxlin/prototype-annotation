# 移动端原型标注与全局说明

仅用于移动端原型。业务页面原有视觉保持不变；标注属于独立评审辅助层，通过圆点、描边、光晕和独立布局与业务功能区分，不继承或改写业务页面的设计体系。

## 默认交付

除非用户明确关闭标注，移动端原型默认自动生成：

1. **页面功能点标注**：解释字段、状态、权限、校验、流程、危险操作和缺省/异常处理。
2. **原型说明**：根据对话、PRD、需求文档和已确认结论，自行判断需要形成哪些跨页面内容；不强制生成固定栏目。

原型说明候选内容包括业务背景、原型范围、功能架构、业务规则、角色权限、版本变更、验收建议、风险和待确认项。只生成材料真正支持的内容；缺失事实标为“待确认”，不得臆造。

## 两种查看模式

标注数据和作用域核心只有一套，呈现层按视口自动切换：

### PC 查看移动端原型（视口宽度 `>= 768px`）

- 宽屏优先使用三栏：左侧原型说明、中间固定宽度手机原型、右侧当前标注。
- 原型说明包含左侧栏目导航和右侧正文，不显示“某某页面 · 某某详情”等重复副标题。
- 当前标注常驻显示，标题栏提供“显示标注”开关；关闭时只隐藏圆点，标注列表仍保留。
- 点击圆点滚动并高亮右侧对应标注；点击右侧标注滚动并高亮手机原型中的目标元素。
- 宽屏只保留 `16px` 安全边距，不保留大面积装饰性左右留白；中间手机画板保持稳定宽度。
- 左侧原型说明支持拖拽调宽；硬上限为 `820px`，实际最大值按当前视口动态计算，并始终为手机画板和右侧当前标注保留可用空间。
- 中等桌面宽度不足以容纳三栏时，将原型说明收起为“说明”入口；打开后必须把说明面板临时挂载到 `.protoMobile-overlay-root` 顶层，面板位于遮罩之上且可点击，同时隐藏页面标注圆点；关闭后把面板恢复到三栏原位置。不得只提高面板内部 `z-index`，也不得压缩手机画板到失真。

### 手机查看移动端原型（视口宽度 `< 768px`）

- 隐藏 PC 两侧说明栏，只显示业务原型。
- 右下角显示可拖动“注”入口，默认位于固定底部操作栏上方，拖动后不得越出视口。
- “注”菜单包含页面标注开关和原型说明入口；手机端默认隐藏圆点，用户开启后显示。
- 点击圆点使用 Bottom Sheet 展示标注详情；支持手势拖动和小/中/大三档高度，也提供明确的高度切换按钮。
- 原型说明使用全屏独立层展示，关闭后返回原业务页面并恢复此前标注开关状态。

视口宽度只决定查看方式，不改变需求平台判定。移动端原型在 PC 浏览器中仍然是移动端原型。

## 作用域契约

为移动业务页面、Tab 内容、底部弹层和弹窗根节点添加：

```html
<main data-proto-app data-proto-platform="mobile" data-proto-scope="page:order-detail" data-proto-layer="0">
  <section data-proto-scope="page:order-detail:base" data-proto-layer="0">...</section>
  <section data-proto-scope="page:order-detail:delivery" data-proto-layer="0" hidden>...</section>
</main>
<section data-proto-scope="sheet:more-actions" data-proto-layer="20">...</section>
<section data-proto-scope="dialog:void-confirm" data-proto-layer="30">...</section>
```

- 页面使用 `0`，Bottom Sheet/抽屉使用 `20`，确认弹窗使用 `30`。
- 当前可见节点中 `data-proto-layer` 最大者是当前作用域；只显示该作用域标注，底层标注全部隐藏。
- 有 Tab 的页面必须使用三级精确 scope，例如 `page:order-detail:base`；切换 Tab 时同步切换可见面板，不能把所有 Tab 标注放进同一个页面 scope。
- 当前页面跨 Tab 公共标注使用 `page:order-detail:*`；`page:*` 只用于所有页面都存在的真正全局公共元素，不能代替页面级公共 scope。
- 当前标注按“当前精确 scope + 当前页面 `:*` + `page:*`”合并，再过滤不存在、`hidden`、`display:none`、`aria-hidden=true` 或零尺寸目标；过滤后重新连续编号。
- 若高层 Bottom Sheet/抽屉在某页面状态下始终可见且没有关闭或隐藏入口，该高层 scope 就代表整个组合状态；同时可见的底层页面业务点也应归入该高层 scope，禁止生成永远无法成为当前作用域的底层 page 标注。
- 弹层打开和关闭必须通过 `class`、`hidden`、`style` 或 `aria-hidden` 表达；特殊交互完成后触发 `document.dispatchEvent(new Event("prototype-annotation:scopechange"))`。
- 每个页面导航、Tab、Bottom Sheet、抽屉或弹窗入口必须设置 `data-proto-route="对应 scope"`；弹层入口放在其所属业务页面内，标注编辑器据此先切换页面再打开弹层。新原型不得只依赖按钮 ID 或全局函数名推断入口。
- 标注数量由当前页面、Tab 或弹层的真实复杂度决定，可以没有标注，最多通常不超过 8 条；禁止为了统一数量标注明显按钮。

## 标注数据

使用合法 JSON，默认 Markdown：

```json
{
  "prototypeId": "mobile-order-detail-v1",
  "version": 1,
  "mobile": {
    "appRoot": "[data-proto-app]",
    "deviceWidth": 414,
    "scrollContainers": ["[data-proto-scroll-container]", ".main-scroller"]
  },
  "globalMeta": {
    "name": "订单详情原型",
    "version": "V0.1",
    "updatedAt": "2026-07-23"
  },
  "globalSections": [
    {
      "id": "overview",
      "title": "原型概览",
      "format": "markdown",
      "content": "用于查看订单信息和办理过程。"
    }
  ],
  "annotations": [
    {
      "id": "order-summary",
      "scope": "page:order-detail:*",
      "target": "[data-ui=order-summary]",
      "x": 0.94,
      "y": 0.25,
      "title": "订单摘要保持跨页签一致",
      "format": "markdown",
      "content": "订单编号、状态和来源属于订单级信息，切换页签后保持不变。"
    }
  ]
}
```

- 移动业务原型必须且只能有一个 `data-proto-app` 根节点，并声明 `data-proto-platform="mobile"`；`mobile.appRoot` 固定使用 `[data-proto-app]`，缺少、重复或改用其他选择器时注入器直接停止。
- 业务 HTML 不要自行绘制 PC 手机边框、手机壳或固定宽度展示舞台，PC 手机画板由标注框架统一提供。`[data-proto-app]` 必须样式自包含，不依赖 `.phone-frame [data-proto-app]` 等外层选择器才能正常显示。
- 运行时必须将 `.protoMobile-stage` 和 `.protoMobile-overlay-root` 直接挂到 `body`，并使用 `position:fixed; inset:0; width:100vw; height:100dvh`。禁止把三栏框架插入业务根节点原父容器；原父容器即使为 `414px + overflow:hidden` 也不能影响审阅框架。
- `mobile.deviceWidth` 推荐 `414`，运行时在窄视口缩放为 `100%`，不改变业务字阶。
- `mobile.scrollContainers` 声明唯一允许由标注定位滚动的业务正文容器；正文容器优先增加 `data-proto-scroll-container`。
- `target` 优先使用稳定 `id`、`data-ui` 或语义 class，禁止依赖易变化的 `nth-child`。
- 标注必须承载业务含义、权限、状态条件、校验、口径、流程、操作影响或异常处理。常规导航栏、页面标题、返回按钮、页签切换、左右布局、卡片/列表/表格展示，以及没有附加业务规则的下钻、搜索、筛选、刷新、分页、导入导出或增删改不生成标注。
- `x`、`y` 是目标元素内相对坐标，范围 `0–1`。
- Navbar、固定底栏等非正文目标设置 `"scroll": false`，或在目标/祖先节点添加 `data-proto-scroll="none"`。
- Markdown 支持标题、列表、引用、表格、链接、代码块、Base64 图片和 Mermaid；图片不得引用本地路径或网络 URL。

## 定位规则

- 标注圆点使用固定顶层容器，坐标基于标注图层自身的 `getBoundingClientRect()` 计算，不基于业务根节点猜测偏移。
- 定位前先判断目标是否完整位于手机画板有效可视区；已可见时只高亮，不滚动。
- 点击右侧标注时，只允许滚动 `mobile.scrollContainers` 明确声明的业务正文容器；找不到合法容器时只高亮，禁止回退到 `scrollIntoView()`。
- Navbar、固定底栏和设置了 `scroll:false` / `data-proto-scroll="none"` 的目标永不触发滚动。
- 滚动值限制在 `0 ～ scrollHeight-clientHeight`，滚动监测必须绑定实际发生滚动的正文容器；`.protoMobile-device`、PC 工作台和浏览器窗口的滚动位置必须保持不变。
- 平滑滚动期间每帧重新计算圆点位置；连续三帧滚动量小于 `0.5px` 后再执行最终高亮和校准，禁止使用固定 `300ms` 延时假定滚动已结束。
- 目标滚出手机画板可视区域后隐藏对应圆点；目标重新进入时恢复。
- 浏览器 `resize`、内部滚动、页签切换、弹层开关和内容尺寸变化后都重新布局圆点。

## 注入流程

1. 先完成移动端业务原型，根节点添加 `data-proto-app`；页面、Tab 面板和弹层添加作用域属性，页面导航、Tab 与弹层入口添加 `data-proto-route`，业务正文添加 `data-proto-scroll-container`。
2. 根据用户材料生成 `globalSections` 和 `annotations`。
3. 将数据写入 JSON，然后从 skill 目录执行：

```powershell
node scripts/inject-mobile-annotations.mjs "目标原型.html" "标注数据.json"
```

脚本会把固定样式、PC/手机两套呈现层、Marked、Mermaid 和数据内嵌到同一 HTML。再次运行应更新既有框架，不得重复注入。

移动端与 Web 共用静态质量门禁：检查作用域格式、通用容器目标、低价值标注、跨页面重复坐标、重复正文、乱码和 `nth-child` 等不稳定选择器。低价值标注包括只解释导航、标题、返回、页签切换或泛化下钻且没有权限、条件、状态、口径、影响等业务信息的内容。生成阶段 `annotationQuality.status` 只允许为 `pass`，`warning` 和 `fail` 都会停止注入。

用户要求增删改标注或原型说明时，读取 `annotation-editing-guide.md`，使用与 Web 完全相同的共享编辑工作台。移动端只由适配层识别 `[data-proto-app]`、Tab 和最高弹层 scope，不得另建一套编辑界面。生成原型时不得使用 `--allow-quality-warnings` 绕过质量门禁。

注入完成后必须执行：

```powershell
node scripts/audit-single-html.mjs "目标原型.html"
```

审计状态必须为 `pass`；外部脚本、样式、图片、字体、本地路径、相对资源、远程 Markdown 图片或重复 ID 都会阻止交付。

## 验证清单

### 1. 全量自动门禁

- 每次首次生成和编辑写回都检查全部标注数据，不做抽样：`annotationQuality.status` 必须为 `pass`，所有 target、页面/Tab/Bottom Sheet/弹窗 scope、坐标、正文、原型说明栏目和图片引用合法。
- 每次运行 `audit-single-html.mjs`；状态必须为 `pass`，最终 HTML 不包含外部或相对资源。
- 对全部标注正文做一次语义核对，确认其描述的是目标控件背后的业务规则；直接核对结构化数据，不要求为每条标注单独打开页面。

### 2. 首次注入的快速浏览器检查

- 默认只验证当前页面，不切换其他页面、Tab、Bottom Sheet、抽屉或弹窗。
- PC 审阅使用 `1440×900`，确认三栏存在、一个圆点与右侧卡片双向定位正常，手机画板没有被带动滚动。
- 手机查看使用 `390×844`，确认“注”入口可点击、一个圆点能打开详情；不逐项测试所有栏目、拖动和高度档位。
- 当前核心流程自然打开弹层时顺带检查最高层 scope；不要为了验证专门遍历其他弹层。

### 3. 自动诊断与升级

- 对当前页面读取 `window.__prototypeMobileDiagnostics.inspect()`；`layoutAudit.status` 必须为 `pass`，`configuredCount`、`listCount`、`markerNodeCount` 一致，`invalidTargetIds`、`hiddenTargetIds`、`undersizedTargetIds` 和 `markerOutsideDeviceIds` 为空。
- 自动报告指向的告警页面、Tab、弹层或标注必须追加浏览器验证，不受代表性数量限制。
- 只有注入或单 HTML 审计失败、当前页面诊断异常、当前页面点击失败，或用户明确要求全面检查时，才扩大到受影响页面；不得自动遍历全部页面和弹层。
- 抽样只减少重复浏览器操作；任何异常都必须修复并扩大验证范围，不得在存在 warning 或动态失败时输出“验证通过”。
- `annotationQuality.status` 与 `audit-single-html.mjs` 状态均为 `pass`。
- `annotationQuality.lowValueAnnotationCount` 为 `0`，没有无业务信息的导航、标题、返回、页签或下钻标注。
- 原型说明栏目由材料驱动，不生成空栏目；PC 左栏和手机全屏层内容一致。
- 断网打开仍可用，无 CDN、相对路径、外部字体或图片依赖；浏览器控制台无错误。
