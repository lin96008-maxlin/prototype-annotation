# Prototype Annotation

把业务说明、交互规则和评审意见直接写进单个 HTML 原型，让一份文件同时承担原型、PRD 补充说明和评审载体。

## 为什么使用

- **更清晰的原型逻辑**：标注绑定真实页面元素，补充界面本身看不出的字段含义、计算口径、权限、状态条件、校验、流程和异常处理。
- **更适合交流与汇报**：支持浮动标注、三栏审阅和集中原型说明，业务、产品、设计和研发可围绕同一份 HTML 讨论。
- **减少文档分散**：原型、跨页面规则、功能架构、角色权限、版本记录和验收建议可封装在同一个自包含 HTML 中。
- **离线可交付**：最终 HTML 内嵌样式、运行时、Markdown 和 Mermaid 支持，不依赖 CDN、在线图片或外部字体。
- **可视化编辑**：通过本机 localhost 工作台编辑原型说明、增删标注、定位圆点并写回原 HTML。

## 功能展示

> 截图中的名称和数据仅用于展示交互效果，后续可直接替换 `docs/images/` 下的同名文件。

### 1. 打开原型说明

![打开原型说明](docs/images/01-prototype-docs.png)

### 2. 浮动标注模式

![浮动标注模式](docs/images/02-floating-annotations.png)

### 3. 三栏审阅模式

![三栏审阅模式](docs/images/03-three-column-review.png)

### 4. 编辑原型说明

![编辑原型说明](docs/images/04-edit-prototype-docs.png)

### 5. 定位标注圆点

![定位标注圆点](docs/images/05-locate-annotation-marker.png)

### 6. 编辑标注

![编辑标注](docs/images/06-edit-annotation.png)

## 安装

### 方式一：使用 Codex 内置安装器

PowerShell：

```powershell
python "$HOME\.codex\skills\.system\skill-installer\scripts\install-skill-from-github.py" `
  --repo lin96008-maxlin/prototype-annotation `
  --path prototype-annotation
```

macOS / Linux：

```bash
python ~/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py \
  --repo lin96008-maxlin/prototype-annotation \
  --path prototype-annotation
```

安装器会将 Skill 安装到 `~/.codex/skills/prototype-annotation`。如果同名目录已经存在，安装器会停止，避免覆盖现有内容。安装后从下一轮 Codex 对话开始使用。

### 方式二：手动安装

PowerShell：

```powershell
git clone https://github.com/lin96008-maxlin/prototype-annotation.git
New-Item -ItemType Directory -Force "$HOME\.codex\skills" | Out-Null
Copy-Item -Recurse ".\prototype-annotation\prototype-annotation" "$HOME\.codex\skills\prototype-annotation"
```

macOS / Linux：

```bash
git clone https://github.com/lin96008-maxlin/prototype-annotation.git
mkdir -p ~/.codex/skills
cp -R ./prototype-annotation/prototype-annotation ~/.codex/skills/prototype-annotation
```

## 使用方式

### 为现有 HTML 添加标注

在 Codex 中发送：

```text
使用 $prototype-annotation，为 C:\path\to\prototype.html 添加业务标注和原型说明。
```

可以同时提供 PRD、需求说明、会议纪要或已确认的业务规则。Skill 会判断 Web 或移动端，补充必要的无视觉定位属性，并把标注框架写入同一个 HTML。

### 检查或优化已有标注

```text
使用 $prototype-annotation，全面检查 C:\path\to\prototype.html 的标注、作用域、定位和原型说明。
```

### 进入本地编辑模式

```text
使用 $prototype-annotation，打开 C:\path\to\prototype.html 的标注编辑模式。
```

Codex 会启动 localhost 编辑服务并返回实际 `editUrl`。编辑工作台支持：

- 新增、删除和修改原型说明栏目；
- 新增、拖动、删除和修改标注；
- 当前页面与全部页面切换；
- Web 与移动端统一三栏编辑；
- 单条标注选择 AI 润色；
- 保存编辑会话并写回原 HTML。

### 应用本轮修改

完成编辑后回到 Codex 对话并发送：

```text
使用 $prototype-annotation，应用本轮标注修改。
```

Skill 会读取当前 HTML 的活动编辑会话，刷新展示框架，执行质量检查并按变更范围决定是否需要浏览器复核。

## 适用范围

适合：

- 产品原型评审、需求澄清和内部汇报；
- 需要把跨页面规则、权限、状态流转或计算口径与页面绑定的场景；
- 需要交付单个自包含 HTML，而不希望同时维护多份零散说明文档的团队。

不负责：

- 重新设计业务页面；
- 替换现有 UI 设计体系；
- 根据零散需求从头生成完整业务原型；
- 在没有事实依据时补造业务规则。

## 原型要求

- 输入必须是完整的单 HTML 文件。
- Web 或移动端业务界面应具有唯一 `[data-proto-app]` 根节点。
- 根节点声明 `data-proto-platform="web"` 或 `data-proto-platform="mobile"`。
- 页面、Tab、抽屉、Bottom Sheet 和 Dialog 使用独立 `data-proto-scope`。
- 图片应内嵌为 data URI；最终文件不依赖本地相对路径或网络资源。

缺少这些属性时，Skill 只补充必要的无视觉定位契约，不改动业务视觉。

## 本地编辑数据

编辑服务会在原型文件旁创建：

```text
.prototype-review/{prototypeKey}/
├─ manifest.json
└─ sessions/{sessionId}.json
```

这些文件保存未应用的编辑会话，可能包含业务说明。请按项目的数据安全要求管理，不要将真实敏感信息提交到公共仓库。

## 目录结构

```text
prototype-annotation/
├─ README.md
├─ LICENSE
├─ THIRD_PARTY_NOTICES.md
├─ docs/images/
└─ prototype-annotation/
   ├─ SKILL.md
   ├─ agents/
   ├─ assets/
   ├─ references/
   ├─ scripts/
   └─ tests/
```

## 技术说明

- 注入与写回脚本使用 Node.js 标准库，无需业务后端。
- Marked 用于 Markdown 渲染，Mermaid 用于流程图和架构图渲染。
- 最终 HTML 会保留必要的第三方许可证告知。
- `tests/` 用于 Skill 自身回归，不会进入用户的原型数据。

## 许可证

本项目自研部分采用 [MIT License](LICENSE)。第三方组件的许可证与归属见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 及 `prototype-annotation/assets/web-annotation/` 下的原始许可证文件。

