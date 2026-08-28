# 参与贡献

感谢你改进 Prototype Annotation。

## 适合提交的内容

- Web 或移动端原型中的作用域、定位、滚动和弹层兼容问题；
- 标注编辑、原型说明和写回流程中的真实使用问题；
- 能减少低价值、重复或模板化标注的质量规则；
- 浏览器兼容性、可访问性和单 HTML 离线交付改进；
- 文档、安装说明和通用测试场景修正。

## 提交 Issue

请说明：

1. 使用的是 Web 还是移动端原型；
2. 期望结果与实际结果；
3. 可复现的最小步骤；
4. 浏览器、Node.js 和操作系统版本；
5. 已脱敏的最小 HTML 或截图。

不要提交真实客户名称、内部地址、账号、Token、未脱敏原型或其他敏感材料。安全问题请按 [SECURITY.md](./SECURITY.md) 私下反馈。

## 提交 Pull Request

1. 保持 Skill 的职责仅限原型标注、原型说明和编辑写回，不重新设计业务 UI。
2. Web 与移动端共用同一编辑器，避免增加重复实现。
3. 新规则需要提供正例或反例，不能只增加字符串断言。
4. 修改注入器、运行时或编辑器后，运行：

```bash
node prototype-annotation/scripts/test-skill.mjs
```

5. 涉及浏览器交互时，在已安装 Playwright 的环境中运行：

```bash
node prototype-annotation/scripts/qa-editor-platform.cjs
```

6. 确保最终 HTML 不依赖 CDN、本地相对资源或外部字体，并保留第三方许可证告知。

提交信息应简洁说明变化目的，例如：

```text
fix: correct mobile annotation scope switching
docs: clarify localhost editing workflow
test: cover repeated annotation targets
```

