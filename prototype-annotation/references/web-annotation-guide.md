# Web 原型标注与全局说明

仅用于 Web 原型。移动端任务不要读取或注入本框架；一次交付只注入当前平台的一套标注框架。

## 默认交付

除非用户明确要求关闭标注，Web 原型默认同时生成：

1. **页面标注**：绑定具体页面元素，解释字段、操作、状态、校验、权限和局部业务规则。
2. **原型说明**：从右下角“注”菜单打开，集中呈现需求材料中真正需要跨页面理解的内容，例如业务背景、功能架构、业务规则、角色权限、版本变更或验收测试。

原型说明是评审辅助层，不是业务系统功能。禁止把“系统说明”“原型说明”添加到业务 TopNav、SideNav 或业务页签中。

## 两种同级浏览模式

右下角“注”是标注系统入口，不代表某一种浏览方式。入口菜单顶部必须以同级 segmented control（分段控件）提供：

1. **浮动标注**：业务原型保持全屏，圆点打开可拖动、可收起、可自由缩放的详情窗。
2. **三栏审阅**：左侧原型说明、中间固定比例业务画布、右侧当前作用域标注。适合集中评审和逐条核对。

三栏审阅要求：

- 左右侧栏可独立收起、展开，并通过分隔线拖拽调整宽度；左侧原型说明硬上限为 `760px`，用户主动拉宽时中间固定比例画布继续等比缩小。宽度和收起状态按 `prototypeId` 记忆。
- 收起后必须保留 `44px` 窄栏和可点击的展开按钮。五个网格区域必须绑定明确列位，禁止因隐藏分隔线导致画布、侧栏串位。
- 中间默认使用 `1920×1080` 设计画布，根据可用区域等比缩小并居中。调整侧栏或窗口宽度只改变整体缩放比例，不得触发业务内容重新挤压、重叠或横向溢出。
- 右侧显示当前最高层 scope 的完整富文本标注，并提供圆点显示开关；列表、圆点数量和编号必须一致，点击双方可互相定位。
- 切回浮动标注后，业务 DOM 必须恢复原位置，“注”入口恢复进入三栏前的位置；不得因隐藏状态下执行坐标约束而跑到左上角。
- 三栏审阅仍复用同一套标注数据、作用域、Markdown、Mermaid 和弹层层级机制，不创建第二套入口或重复标注数据。

## 业务根节点契约

为保证三栏模式能够无损搬入固定画布，Web 业务界面必须放在唯一根节点中：

```html
<body>
  <div id="app" data-proto-app data-proto-platform="web">
    <!-- TopNav、SideNav、页面、业务抽屉与业务弹窗 -->
  </div>
</body>
```

- `data-proto-app` 必须唯一，声明 `data-proto-platform="web"`，并使用 `width:100%; height:100%`。页面骨架优先基于根节点百分比计算高度，不把 `100vw/100vh` 散落到内部业务容器。
- 因框架限制必须挂在根节点外的业务弹层或 Toast，标记 `data-proto-portal`，三栏切换时与业务根节点一起搬入和恢复。
- 标注根节点、`prototypeAnnotationData`、Marked、Mermaid 和运行时脚本不得放入业务根节点。
- 注入前必须补齐唯一业务根节点；缺少或存在多个 `data-proto-app` 时注入器直接停止，不使用兼容回退。

## 自动生成全局说明

先分析本轮对话、PRD、需求文档、截图和已确认结论中的跨页面信息，再动态决定栏目名称、数量、顺序以及是否合并。以下仅是候选栏目，不是固定目录：

| 候选栏目 | 可包含内容 |
| --- | --- |
| 原型概览 | 业务背景、建设目标、原型范围、非范围、数据声明 |
| 功能架构 | 一级模块、页面清单、页面用途；模块较多时追加 Mermaid 架构图 |
| 业务规则 | 跨页面口径、对象关系、状态流转、统一约束和关键术语 |
| 角色权限 | 角色职责、功能权限、数据范围、无权限处理方式 |
| 版本与变更 | 原型版本、日期、平台、导航风格、按时间追加的变更记录 |
| 验收与测试 | 从核心流程推导的建议验收用例、预期结果和通用检查项 |

规则：

- 可根据材料增加数据定义、外部依赖、非功能要求、迁移策略、风险与待确认事项等栏目。
- 不得为了套模板生成无关、空白或只有占位话术的栏目。
- 信息高度重合时应合并栏目；材料存在清晰独立主题时可以新增栏目。
- 如果材料没有值得单独呈现的全局信息，`globalSections` 可以为空；运行时隐藏“原型说明”入口，但页面功能点标注仍可使用。
- 只基于用户材料和已确认结论生成；缺失的角色、权限或口径标为“待确认”，不得臆造。
- “验收与测试”必须标注为建议用例，不得伪装成正式测试结论。
- 初次生成使用 `V0.1`；后续修改原型时递增版本并追加真实变更，不覆盖历史记录。
- 全局规则只写一次。页面标注可引用全局规则标题，但不要重复整段正文。
- 所有栏目使用 Markdown；允许标题、列表、引用、表格、链接、行内代码、代码块、Base64 图片和 Mermaid。
- Mermaid 只在流程或架构确实更清楚时使用；代码块只在接口、规则表达式或实现约束确有必要时使用。

## 页面标注生成规则

- 标注数量由页面、抽屉或弹窗的真实复杂度决定，可以没有标注，最多通常不超过 8 条；禁止为了统一数量或达到配额标注明显按钮。
- 优先标注：统计口径、字段语义、必填与校验、权限差异、状态流转、批量操作、不可逆影响、跨页面联动、空/错/加载状态。
- 标题直接表达结论，例如“查询条件共同决定下方统计口径”，不要写“按钮说明”。
- 正文不重复显示页面名、分类标签或标注标题。
- 标注点使用稳定的 `id`、`data-*` 或语义 class 选择器；禁止依赖易变化的 `nth-child`。
- 优先绑定当前页面特有的筛选区、指标卡、表格、状态开关、审批按钮等具体业务元素。`.page-panel-body`、`.page-panel-header`、`.content`、`.page`、`main` 等通用容器只能用于确实解释整个区域的少量标注，不能成为主要目标。
- 每条标注必须补充界面本身看不出的业务信息，例如字段含义、统计口径、权限、状态条件、校验、流程前后置、操作影响或异常处理。不要标注普通导航、标题、返回、页签、左右布局或卡片/列表/表格展示；不要只写支持下钻、搜索、筛选、刷新、分页、导入导出或增删改，应改写为相关权限、条件、范围、口径、上下文继承、影响或失败处理。
- 不得跨页面复制同一组 `target + x + y` 或相同正文。真正跨页面共用的系统外壳标注只生成一次并使用 `scope: "page:*"`；页面核心业务标注必须使用精确 scope。
- 标注点不得遮挡文字、输入内容和主要操作。浏览器实测后调整 `x`、`y`。
- 页面、抽屉、弹窗使用不同 scope；只显示当前最高层可见 scope 的标注。

## 作用域契约

生成业务 HTML 时为页面和弹层根节点添加：

```html
<section data-proto-scope="page:dashboard" data-proto-layer="0">...</section>
<aside data-proto-scope="drawer:order-detail" data-proto-layer="20">...</aside>
<section data-proto-scope="modal:delete-confirm" data-proto-layer="30">...</section>
```

- 页面层使用 `0`。
- 抽屉使用 `20`。
- 模态弹窗使用 `30`。
- 当前可见节点中 `data-proto-layer` 最高者为当前作用域，底层标注自动隐藏。
- `page:*` 只用于所有 Web 页面都存在的公共系统外壳；当前页面会合并精确 page scope 与 `page:*`。抽屉和弹窗不得使用通配 scope。
- 页面切换和弹层开关应通过 `class`、`hidden`、`style` 或 `aria-hidden` 表达；框架会自动检测。
- 业务弹层必须优先在实际弹层根节点声明 `data-proto-scope`。框架仅为旧原型提供兼容兜底：点击 `[data-drawer]`、`[data-modal]`、`[data-dialog]` 或带完整 scope 的 `[data-proto-route]` 后，会把当前可见的 `.drawer-overlay.open`、`.modal-overlay.open`、`.dialog-overlay.open` 等识别为最高层作用域。兼容兜底不得代替新原型的显式声明。
- 新原型的页面导航、系统页签、下钻入口和弹层入口必须声明 `data-proto-route="对应 scope"`。例如进入订单列表使用 `data-proto-route="page:order-list"`，打开详情抽屉使用 `data-proto-route="drawer:order-detail"`；业务原有点击逻辑保持不变。
- 特殊渲染方式无法被自动检测时，切换后触发：`document.dispatchEvent(new Event("prototype-annotation:scopechange"))`。

## 弹层与标注层级契约

业务弹层和标注系统必须遵守同一套层级约束：

| 层级 | 用途 |
| --- | --- |
| `0–9999` | 业务页面、下拉、Toast、遮罩、抽屉和弹窗 |
| `2147483000` | `.protoWeb-root` 的普通 `z-index` 兜底起点 |
| 浏览器 `top layer` | 支持 Popover API 时，`.protoWeb-root` 的首选承载层 |

- `.protoWeb-root` 必须作为 `body` 直属节点注入，不能放进带 `transform`、`filter`、`opacity`、`contain`、`isolation` 或较低 `z-index` 的业务容器。
- 不要只提高 `.protoWeb-launcher`、`.protoWeb-marker` 或详情窗的内部 `z-index`；父级 `.protoWeb-root` 的层叠上下文才决定整套标注能否越过业务弹层。
- 固定框架优先用 `popover="manual"` 把 `.protoWeb-root` 放进浏览器 `top layer`，并在业务 `<dialog>`、抽屉或弹窗打开后重新提升到顶层；不支持 Popover API 时使用 `2147483000` 以上的动态 `z-index`。
- 运行时扫描宿主页面可见元素的计算后 `z-index`，并通过 `window.__prototypeWebDiagnostics.inspect()` 返回最高业务层、标注层模式、当前作用域和入口命中结果。
- 运行时用 `document.elementFromPoint()` 检查“注”入口中心点。命中元素必须是入口本身或其子节点；否则先自动修复层级，仍失败时输出明确错误。
- 原生 `<dialog>` 属于浏览器 `top layer`，不能只靠普通 `z-index` 解决；必须保留框架的 Popover 兼容逻辑并在弹窗开关后触发作用域同步。

## 数据结构

标注数据必须是合法 JSON，不能用字符串拼接伪造。推荐用结构化序列化写入：

```json
{
  "prototypeId": "example-v1",
  "version": 1,
  "review": {
    "designWidth": 1920,
    "designHeight": 1080
  },
  "globalMeta": {
    "name": "示例系统原型",
    "version": "V0.1",
    "updatedAt": "2026-07-23"
  },
  "globalSections": [
    {
      "id": "overview",
      "title": "原型概览",
      "format": "markdown",
      "content": "# 原型概览\n\n## 业务背景\n\n根据 PRD 生成。"
    }
  ],
  "annotations": [
    {
      "id": "dashboard-filter",
      "scope": "page:dashboard",
      "target": "[data-ui=dashboard-filter]",
      "x": 0.02,
      "y": 0.5,
      "title": "筛选条件共同决定统计口径",
      "format": "markdown",
      "content": "**查询**后同步刷新指标与图表。\n\n- 条件之间为交集关系。"
    }
  ]
}
```

字段说明：

- `scope`：必须与业务根节点的 `data-proto-scope` 完全一致。
- 旧原型使用共用弹层容器时，触发按钮的 `data-drawer` / `data-modal` 值必须与标注 scope 后半段一致；若不一致，使用 `data-proto-route="drawer:order-detail"` 显式指定。
- `review`：可选；Web 三栏审阅的固定设计画布尺寸，默认 `1920×1080`。只有需求明确指定其他设计基准时才修改。
- `target`：当前 scope 内可查询到的 CSS 选择器。
- `x`、`y`：标注点在目标元素内的相对位置，范围为 `0–1`。
- `format`：默认按 Markdown 解析；仅兼容旧内容时使用 `html`。
- Markdown 图片必须使用 `data:image/...;base64,...`，不得引用本地路径或网络 URL。

## 注入流程

1. 先完成业务原型及核心交互，给页面和弹层添加作用域属性。
2. 根据 PRD 生成 `globalSections` 和 `annotations` 数据。
3. 将数据写入临时 JSON，或先写入 HTML 的 `<script id="prototypeAnnotationData" type="application/json">`。
4. 从当前 skill 目录执行：

```powershell
node scripts/inject-web-annotations.mjs "目标原型.html" "标注数据.json"
```

若 HTML 已包含合法 `prototypeAnnotationData`，第二个参数可以省略。脚本会内嵌 CSS、交互框架、Marked、Mermaid 和数据，最终仍只有一个 HTML。

脚本输出中的 `annotationQuality`、`hostMaxDeclaredZIndex`、`nativeDialogs` 和 `reviewModeContract` 用于提前发现标注质量、宿主层级和三栏结构风险。`reviewModeContract` 必须为 `standard`；缺少唯一 `data-proto-app` 时脚本停止。`annotationQuality.status` 只允许为 `pass`，包括低价值标注在内的 `warning` 和 `fail` 都会停止注入。

用户要求增删改标注或原型说明时，读取 `annotation-editing-guide.md` 并使用共享编辑服务。编辑写回会重新运行注入器刷新完整展示框架；旧版无区块标记 Web 框架只允许由写回服务使用 `--migrate-legacy` 迁移。生成原型时不得使用 `--allow-quality-warnings` 绕过质量门禁。

静态质量门禁：

- 所有 `x`、`y` 必须是 `0–1` 的有限数字，正文必须是字符串。
- 通用容器目标占比超过 25% 警告，超过 50% 失败；规则在标注数不少于 6 条时启用。
- 相同 `target + x + y` 跨至少 3 个 scope 且占比超过 25% 警告，超过 50% 失败。
- 相同标题与正文跨至少 3 个 scope 且占比超过 25% 警告，超过 50% 失败。
- 出现替换字符、典型乱码或大量异常 `?` 时失败。
- 报告必须包含 scope 数量、各 scope 标注数、目标选择器分布、重复坐标比例、重复正文比例和问题清单。

静态检查无法完全判断目标的真实可见性，因此首次注入后只对当前页面做一次快速浏览器检查；不要默认遍历其他页面。

注入完成后必须执行最终单文件审计：

```powershell
node scripts/audit-single-html.mjs "目标原型.html"
```

审计状态必须为 `pass`；外部脚本、样式、图片、字体、本地路径、相对资源、远程 Markdown 图片或重复 ID 都会阻止交付。

## 验证清单

### 1. 全量自动门禁

- 每次首次生成和编辑写回都检查全部标注数据，不做抽样：`annotationQuality.status` 必须为 `pass`，`lowValueAnnotationCount` 必须为 `0`，所有 target、scope、坐标、正文、原型说明栏目和图片引用合法。
- 每次运行 `audit-single-html.mjs`；状态必须为 `pass`，最终 HTML 不包含外部或相对资源。
- 对全部标注正文做一次语义核对，确认其描述的是目标控件背后的业务规则；这一步直接核对结构化数据，不要求为每条标注单独打开页面。

### 2. 首次注入的快速浏览器检查

- 默认只打开当前页面，不切换到普通页、复杂页或其他业务页面。
- 使用 `1440×900` 检查“注”入口可点击、一个圆点能一次打开正确详情、三栏中的对应卡片能定位目标。
- 在当前页面往返切换一次浮动标注与三栏审阅，确认两种模式能正常进入和返回；不逐项测试所有调宽、收起和拖动操作。
- 当前核心流程自然打开抽屉或弹窗时顺带检查最高层 scope；不要为了验证专门遍历其他弹层。

### 3. 自动诊断与升级

- 对当前页面读取 `window.__prototypeWebDiagnostics.inspect()`；`invalidTargetIds`、`hiddenTargetIds`、`overlapPairs`、`outOfViewportIds` 必须为空，`data-proto-launcher-clickable` 必须为 `true`。
- 自动报告指向的告警页面、scope 或标注必须追加浏览器验证，不受代表性数量限制。
- 只有注入或单 HTML 审计失败、当前页面诊断异常、当前页面点击失败，或用户明确要求全面检查时，才扩大到受影响页面；不得自动逐页点击全部标注。
- 抽样只减少重复浏览器操作；任何异常都必须修复并扩大验证范围，不得在存在 warning 或动态失败时输出“验证通过”。
- 断网打开 HTML，功能、样式、图片、Marked 和 Mermaid 均可用，无外部依赖。
- 浏览器控制台无脚本错误；最终 HTML 中不存在相对路径或 CDN 资源。
