---
name: prototype-annotation
description: "为已有 Web 或移动端单 HTML 原型生成、注入、检查、修改和写回业务功能点标注与全局原型说明，并提供 Web 浮动/三栏审阅、移动端 PC/手机双呈现及共用 localhost 标注编辑工作台。在原型上下文中，用户提出添加标注、生成标注、完善原型说明、检查标注、修改标注、编辑标注、进入编辑模式、进入标注编辑模式、我要编辑标注或同义请求时使用。只处理标注及必要的无视觉定位属性，不重新设计业务 UI。"
---

# 原型标注

## 职责边界

在已有单 HTML 原型上增加和维护标注能力。

- 负责：功能点标注、全局原型说明、Web/移动端标注展示、标注编辑、AI 润色、写回和质量验证。
- 不负责：重新设计业务页面、切换设计体系、调整业务布局或重新生成整套原型。
- 若没有可处理的 HTML，说明本技能只处理已有单 HTML 原型，并请求用户提供目标文件；不要扩展为新建业务原型。
- 修复定位时只允许增加稳定 `id`、`data-*`、scope 和 route 属性；确需改变业务交互时先说明原因。

## 资源导航

所有路径相对于本技能目录。

- `references/web-annotation-guide.md`：Web 标注数据、原型说明、作用域、展示和验证规则。
- `references/mobile-annotation-guide.md`：移动端标注数据、PC/手机呈现、作用域、滚动和验证规则。
- `references/annotation-editing-guide.md`：Web/移动端共用编辑工作台、独立会话、AI 润色、写回和分级验收。
- `assets/web-annotation/`：Web 浮动标注与三栏审阅资源。
- `assets/mobile-annotation/`：移动端 PC/手机标注呈现资源。
- `assets/annotation-editor/`：两端共用的 localhost 标注编辑工作台。
- `scripts/inject-web-annotations.mjs`：Web 标注注入器。
- `scripts/inject-mobile-annotations.mjs`：移动端标注注入器。
- `scripts/prototype-annotation-review.mjs`：编辑服务、会话管理和写回工具。
- `scripts/annotation-quality.mjs`：标注质量检查。
- `scripts/audit-single-html.mjs`：单 HTML 审计。
- `scripts/audit-self-contained.mjs`：发布与回归时检查外部 Skill 路由、旧名称和私有路径残留。

只有新增或检查标注时读取对应平台指南；只有进入编辑模式或应用修改时读取编辑指南。运行时只按上述本目录资源导航渐进读取，不读取本目录外的组件范式或设计规范。

## 任务路由

### 添加或重建标注

1. 确认目标 HTML 和用户提供的 PRD、需求文档或对话材料。
2. 优先根据 `[data-proto-app][data-proto-platform="web|mobile"]` 判断平台；旧原型缺少属性时再结合页面结构判断，仍无法可靠判断时向用户确认。
3. 读取对应平台标注指南，分析页面、Tab、弹层、角色、状态和业务规则。
4. 原型缺少稳定定位属性时，仅补充“原型接口契约”中的无视觉属性。
5. 根据材料自动生成功能点标注和必要的全局原型说明栏目，不固定六类目录，不生成空栏目。
6. 使用结构化 JSON 调用对应注入脚本，禁止手工拼接非法 JSON 或复制另一平台框架。
7. 读取注入器输出的 `annotationQuality`；存在 warning 或 fail 时修复后重跑。
8. 运行单 HTML 审计，再按平台指南只对当前页面做一次快速浏览器检查；默认不遍历其他页面和弹层。

### 编辑标注

用户表达“编辑标注”“进入编辑模式”“进入标注编辑模式”“我要编辑标注”等同义意图时：

直接启动 localhost 编辑服务，不要只解释操作方法或只返回命令。

1. 读取 `annotation-editing-guide.md`。
2. 运行：

```powershell
node scripts/prototype-annotation-review.mjs serve "目标原型.html"
```

3. 使用命令实际返回的完整 `editUrl`，不能自行拼接固定端口；端口占用时工具会自动选择可用端口。打开一次并确认编辑器根节点状态为 `ready` 即可，不自动执行增删改或多页面验证。
4. 保持服务运行，让用户在统一三栏工作台增删改标注和原型说明。
5. 用户回到对话要求应用修改时，只处理该 HTML 的唯一活动 session；逐条完成 `_contentPolicy: "ai-polish"` 的内容后运行：

```powershell
node scripts/prototype-annotation-review.mjs apply "目标原型.html" --session "sessionId"
```

6. 读取 `verificationPlan`：`automatic-only` 只做自动审计；存在 `browserChecks` 时只验证其中列出的受影响 scope；列表为空时直接结束，不自行追加浏览器复查。

### 检查或修复已有标注

- 先判断是标注数据、作用域、路由、运行时、层级还是业务 HTML 定位属性的问题。
- 判断为公共框架缺陷时只报告原因和影响，不在普通标注任务中修改当前 Skill，也不为单个 HTML 制造专用分支。
- 不因检查标注而修改业务视觉；若问题来自业务原型缺少页面或弹层入口，补充最小 route 属性。

## 原型接口契约

### Web

- 唯一业务根节点：`[data-proto-app]`。
- 根节点声明 `data-proto-platform="web"`。
- 页面：`data-proto-scope="page:{id}"`。
- Tab、抽屉、弹窗：独立 `data-proto-scope` / `data-proto-layer`。
- 页面导航和弹层入口：`data-proto-route="对应 scope"`。
- 旧原型可兼容 `[data-page-link]`、`[data-page]` 和全局 `navigate/showPage`，但新补属性优先使用正式契约。

### 移动端

- 唯一业务根节点：`[data-proto-app]`。
- 根节点声明 `data-proto-platform="mobile"`。
- 页面、Tab、Bottom Sheet、抽屉和 Dialog：独立 `data-proto-scope`。
- 对应入口：`data-proto-route="对应 scope"`。
- 正文滚动区：`data-proto-scroll-container`；固定导航和底栏：`data-proto-scroll="none"`。
- 页面 Tab 使用 `page:{页面}:{tab}`，跨 Tab 公共点使用 `page:{页面}:*`。

## 内容规则

- 标注只解释非显而易见的业务含义、计算口径、角色权限、状态条件、校验、流程前后置、操作影响、异常处理或上下文继承。
- 不标注页面标题、常规导航、返回按钮、布局结构，也不只写“支持搜索、筛选、下钻、分页、导入导出、增删改”等肉眼可见能力。
- 数量按页面复杂度决定，不设置每页统一配额，不为凑数量生成模板化内容。
- 绑定具体业务元素，避免主要使用 `.page-panel-body` 等通用容器和重复坐标。
- 不同页面、Tab 和最高弹层使用独立 scope；列表、圆点和编号必须一致，隐藏目标不进入当前标注。
- 全局原型说明根据用户材料自行决定栏目、数量和顺序；缺失事实标“待确认”，不得臆造。
- 正文支持 Markdown 标题、列表、引用、表格、链接、代码块、Base64 图片和 Mermaid。
- 图片必须内嵌为 data URI，不能引用本地路径或网络 URL。

## 展示要求

### Web

- 最终 HTML 同时提供浮动标注和三栏审阅，两者为同级模式。
- 浮动标注圆点单击打开详情；三栏模式的说明栏和当前标注栏可调宽、收起，业务画布固定比例等比缩放。
- 标注根层必须高于业务页面、遮罩、抽屉和弹窗；入口始终可见、可点击、可拖动。
- 页面、抽屉和弹窗只显示当前最高作用域标注，关闭后恢复底层标注。

### 移动端

- PC 查看采用左侧原型说明、中间固定手机画板、右侧当前标注。
- 手机查看通过视口宽度切换为右下角“注”入口、标注 Bottom Sheet 和全屏原型说明。
- 点击列表标注必须切换到对应页面、Tab 或弹层后再定位；只滚动明确业务滚动容器，不滚动手机画板或浏览器窗口。

## 编辑与最终文件

- Web 与移动端共用同一套 `assets/annotation-editor/`，不得再实现第二套编辑界面。
- 最终交付 HTML 只包含标注展示能力；编辑器只在 localhost 预览时临时注入。
- 每个 HTML 使用唯一 `prototypeKey`，每轮编辑使用独立 `sessionId`，避免串稿。
- 本轮新增后又删除的标注直接移除，不记录为“已删除”；同一标注多次修改只计一项变更。
- 写回后保持 localhost 有效并自动刷新到新空白会话。

## 验证分级

- 初次注入：运行完整质量门禁与单 HTML 审计，只在当前页面检查入口、一个标注点和对应详情或列表定位。
- 启动 localhost：编辑地址可访问且编辑器状态为 `ready` 后结束，不测试编辑流程。
- 纯标题、正文或原型说明修改：自动审计通过即可。
- 位置、目标或 scope 修改：只验证受影响页面、Tab 或弹层。
- 只有自动检查失败、当前页面目标不可达、当前页面跨 scope 定位失败，或用户明确提出全面检查时，才扩大验证范围。
