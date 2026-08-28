# Third-Party Notices

本项目会把以下第三方开源组件内嵌到生成的单 HTML 原型中。第三方代码不适用仓库根目录的项目 MIT 授权，其版权和许可证归各自权利人所有。

## Marked

- 组件：Marked 18.0.7
- 用途：Markdown 解析与渲染
- 许可证：MIT License；同时保留其发行包中附带的 Markdown 许可说明
- 源文件：`prototype-annotation/assets/web-annotation/marked.umd.js`
- 完整许可：`prototype-annotation/assets/web-annotation/marked-LICENSE`
- 项目地址：https://github.com/markedjs/marked

## Mermaid

- 组件：Mermaid 11.16.0
- 用途：流程图、架构图等图表渲染
- 许可证：MIT License
- 源文件：`prototype-annotation/assets/web-annotation/mermaid.min.js`
- 完整许可：`prototype-annotation/assets/web-annotation/mermaid-LICENSE`
- 项目地址：https://github.com/mermaid-js/mermaid

`mermaid.min.js` 中还保留了构建产物所含依赖的版权与许可证注释，包括 DOMPurify、js-yaml、lodash 等。不得删除这些注释。

标注注入器会把 Marked 与 Mermaid 的完整许可文本以 HTML 注释形式写入最终单 HTML，确保交付文件与仓库分离后仍保留必要告知。

