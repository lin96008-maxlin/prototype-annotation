import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeAnnotationQuality, attributeValuesOnMarkedElements, countElementsWithAttribute } from "./annotation-quality.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.dirname(scriptDir);
const assetDir = path.join(skillDir, "assets", "mobile-annotation");
const vendorDir = path.join(skillDir, "assets", "web-annotation");
const cliArgs = process.argv.slice(2);
const allowQualityWarnings = cliArgs.includes("--allow-quality-warnings");
const positionalArgs = cliArgs.filter(arg => !arg.startsWith("--"));
const targetArg = positionalArgs[0];
const dataArg = positionalArgs[1];

if (!targetArg) {
  console.error("用法：node inject-mobile-annotations.mjs <目标HTML> [标注数据JSON]");
  process.exit(1);
}

const targetPath = path.resolve(targetArg);
if (!fs.existsSync(targetPath)) {
  console.error(`目标 HTML 不存在：${targetPath}`);
  process.exit(1);
}

const CSS_START = "<!-- PROTO_MOBILE_MOBILE_ANNOTATION_CSS_START -->";
const CSS_END = "<!-- PROTO_MOBILE_MOBILE_ANNOTATION_CSS_END -->";
const UI_START = "<!-- PROTO_MOBILE_MOBILE_ANNOTATION_UI_START -->";
const UI_END = "<!-- PROTO_MOBILE_MOBILE_ANNOTATION_UI_END -->";
const RUNTIME_START = "<!-- PROTO_MOBILE_MOBILE_ANNOTATION_RUNTIME_START -->";
const RUNTIME_END = "<!-- PROTO_MOBILE_MOBILE_ANNOTATION_RUNTIME_END -->";

const readAsset = (directory, name) => fs.readFileSync(path.join(directory, name), "utf8").trim();
const css = readAsset(assetDir, "mobile-annotation.css");
const shell = readAsset(assetDir, "mobile-annotation-shell.html");
const runtime = readAsset(assetDir, "mobile-annotation-runtime.js");
const marked = readAsset(vendorDir, "marked.umd.js").replace(/^\/\/# sourceMappingURL=.*$/gm, "");
const mermaid = readAsset(vendorDir, "mermaid.min.js");
const markedLicense = readAsset(vendorDir, "marked-LICENSE");
const mermaidLicense = readAsset(vendorDir, "mermaid-LICENSE");

function escapeScriptEnd(source) {
  return source.replace(/<\/script/gi, "<\\/script");
}

function licenseComment(name, source) {
  return `<!-- PROTOTYPE_ANNOTATION_THIRD_PARTY_LICENSE: ${name}\n${source.replace(/--/g, "—")}\n-->`;
}

function replaceBlock(html, start, end, block, insertBefore) {
  const startIndex = html.indexOf(start);
  const endIndex = html.indexOf(end);
  if (startIndex >= 0 || endIndex >= 0) {
    if (startIndex < 0 || endIndex < startIndex) throw new Error(`框架区块标记不完整：${start}`);
    return html.slice(0, startIndex) + block + html.slice(endIndex + end.length);
  }
  const anchorIndex = html.toLowerCase().lastIndexOf(insertBefore.toLowerCase());
  if (anchorIndex < 0) throw new Error(`HTML 缺少 ${insertBefore}`);
  return html.slice(0, anchorIndex) + block + "\n" + html.slice(anchorIndex);
}

function removeManagedBlock(html, start, end) {
  const startIndex = html.indexOf(start);
  const endIndex = html.indexOf(end);
  if (startIndex < 0 || endIndex < startIndex) return html;
  return html.slice(0, startIndex) + html.slice(endIndex + end.length);
}

function validateData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("标注数据必须是 JSON 对象");
  if (!Array.isArray(data.annotations)) throw new Error("标注数据缺少 annotations 数组");
  if (!Array.isArray(data.globalSections)) throw new Error("标注数据缺少 globalSections 数组");
  if (data.mobile && typeof data.mobile !== "object") throw new Error("mobile 必须是对象");

  const appRoot = data.mobile?.appRoot || "[data-proto-app]";
  if (typeof appRoot !== "string" || !appRoot.trim()) throw new Error("mobile.appRoot 必须是非空 CSS 选择器");
  if (appRoot !== "[data-proto-app]") throw new Error("mobile.appRoot 必须使用标准选择器 [data-proto-app]");
  if (data.mobile?.scrollContainers !== undefined
    && (!Array.isArray(data.mobile.scrollContainers)
      || data.mobile.scrollContainers.some(item => typeof item !== "string" || !item.trim()))) {
    throw new Error("mobile.scrollContainers 必须是非空 CSS 选择器字符串数组");
  }

  const annotationIds = new Set();
  for (const note of data.annotations) {
    if (!note.id || !note.scope || !note.target || !note.title) throw new Error("每条页面标注必须包含 id、scope、target、title");
    if (typeof note.content !== "string") throw new Error(`页面标注 ${note.id} 的 content 必须是字符串`);
    if (!Number.isFinite(Number(note.x)) || Number(note.x) < 0 || Number(note.x) > 1) throw new Error(`页面标注 ${note.id} 的 x 必须在 0–1 之间`);
    if (!Number.isFinite(Number(note.y)) || Number(note.y) < 0 || Number(note.y) > 1) throw new Error(`页面标注 ${note.id} 的 y 必须在 0–1 之间`);
    if (note.scroll !== undefined && typeof note.scroll !== "boolean") throw new Error(`页面标注 ${note.id} 的 scroll 必须是布尔值`);
    if (annotationIds.has(note.id)) throw new Error(`页面标注 id 重复：${note.id}`);
    annotationIds.add(note.id);
  }

  const sectionIds = new Set();
  for (const section of data.globalSections) {
    if (!section.id || !section.title || typeof section.content !== "string") throw new Error("每个原型说明栏目必须包含 id、title、content");
    if (sectionIds.has(section.id)) throw new Error(`原型说明栏目 id 重复：${section.id}`);
    sectionIds.add(section.id);
  }
  return data;
}

function readExistingData(html) {
  const match = html.match(/<script\s+id=["']prototypeAnnotationData["']\s+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  return { match: match[0], data: validateData(JSON.parse(match[1])) };
}

let html = fs.readFileSync(targetPath, "utf8");
if (!/<\/head>/i.test(html) || !/<\/body>/i.test(html)) throw new Error("目标文件不是完整 HTML 文档");
if (html.includes('id="protoMobileStage"') && !html.includes(UI_START)) {
  throw new Error("目标 HTML 已存在未受区块标记管理的 protoMobileStage；请先人工确认，避免重复注入");
}

let suppliedData = null;
if (dataArg) {
  const dataPath = path.resolve(dataArg);
  suppliedData = validateData(JSON.parse(fs.readFileSync(dataPath, "utf8")));
}

const existingData = readExistingData(html);
const hostAuditHtml = [[CSS_START, CSS_END], [UI_START, UI_END], [RUNTIME_START, RUNTIME_END]]
  .reduce((source, [start, end]) => removeManagedBlock(source, start, end), html);
const appRootCount = countElementsWithAttribute(hostAuditHtml, "data-proto-app");
if (appRootCount !== 1) throw new Error(`移动端业务根节点 data-proto-app 必须且只能有一个，当前发现 ${appRootCount} 个`);
const appPlatforms = attributeValuesOnMarkedElements(hostAuditHtml, "data-proto-app", "data-proto-platform");
if (appPlatforms[0] !== "mobile") {
  throw new Error(`移动端业务根节点必须声明 data-proto-platform="mobile"，当前为 ${appPlatforms[0] || "未声明"}`);
}
const data = suppliedData || existingData?.data || validateData({
  prototypeId: path.basename(targetPath, path.extname(targetPath)),
  version: 1,
  mobile: { appRoot: "[data-proto-app]", deviceWidth: 414 },
  globalMeta: { name: "原型说明", version: "V0.1", updatedAt: new Date().toISOString().slice(0, 10) },
  globalSections: [],
  annotations: []
});
const qualityReport = analyzeAnnotationQuality(data, { platform: "mobile" });
if (qualityReport.status !== "pass" && !(allowQualityWarnings && qualityReport.status === "warning")) {
  console.error(JSON.stringify({ annotationQuality: qualityReport }, null, 2));
  throw new Error(`移动端标注质量检查未通过（${qualityReport.status}），已停止注入；请修复上方报告中的全部问题`);
}
const dataScript = `<script id="prototypeAnnotationData" type="application/json">\n${JSON.stringify(data, null, 2)}\n</script>`;

if (existingData) html = html.replace(existingData.match, () => dataScript);

const cssBlock = `${CSS_START}\n<style id="protoMobileMobileAnnotationStyles">\n${css}\n</style>\n${CSS_END}`;
html = replaceBlock(html, CSS_START, CSS_END, cssBlock, "</head>");

const uiBlock = `${UI_START}\n${shell}\n${UI_END}`;
html = replaceBlock(html, UI_START, UI_END, uiBlock, "</body>");

if (!existingData) {
  const uiEndIndex = html.indexOf(UI_END) + UI_END.length;
  html = html.slice(0, uiEndIndex) + `\n${dataScript}` + html.slice(uiEndIndex);
}

const hasSharedMarked = /id=["']protoWebMarkedVendor["']/.test(html);
const hasSharedMermaid = /id=["']protoWebMermaidVendor["']/.test(html);
const vendorBlocks = [
  hasSharedMarked ? "" : `<script id="protoMobileMarkedVendor">${escapeScriptEnd(marked)}</script>`,
  hasSharedMermaid ? "" : `<script id="protoMobileMermaidVendor">${escapeScriptEnd(mermaid)}</script>`
].filter(Boolean).join("\n");
const licenseNotices = [
  hasSharedMarked ? "" : licenseComment("Marked", markedLicense),
  hasSharedMermaid ? "" : licenseComment("Mermaid", mermaidLicense)
].filter(Boolean).join("\n");
const runtimeBlock = `${RUNTIME_START}\n${licenseNotices}\n${vendorBlocks}\n<script id="protoMobileMobileAnnotationRuntime">\n${escapeScriptEnd(runtime)}\n</script>\n${RUNTIME_END}`;
html = replaceBlock(html, RUNTIME_START, RUNTIME_END, runtimeBlock, "</body>");

const counts = {
  stage: (html.match(/id=["']protoMobileStage["']/g) || []).length,
  root: (html.match(/id=["']prototypeAnnotationRoot["']/g) || []).length,
  data: (html.match(/id=["']prototypeAnnotationData["']/g) || []).length,
  runtime: (html.match(/id=["']protoMobileMobileAnnotationRuntime["']/g) || []).length
};
if (Object.values(counts).some(count => count !== 1)) {
  throw new Error(`注入结果数量异常：${JSON.stringify(counts)}`);
}

const hostZIndexes = Array.from(hostAuditHtml.matchAll(/z-index\s*:\s*(-?\d+)/gi), match => Number(match[1])).filter(Number.isFinite);
const scopeCounts = Object.fromEntries(data.annotations.reduce((groups, note) => {
  groups.set(note.scope, (groups.get(note.scope) || 0) + 1);
  return groups;
}, new Map()));
fs.writeFileSync(targetPath, html, "utf8");
console.log(JSON.stringify({
  target: targetPath,
  bytes: Buffer.byteLength(html),
  appRoot: data.mobile?.appRoot || "[data-proto-app]",
  appRootCount,
  runtimeMountContract: "body-viewport",
  annotations: data.annotations.length,
  annotationQuality: qualityReport,
  qualityWarningsAccepted: allowQualityWarnings && qualityReport.status === "warning",
  annotationScopes: scopeCounts,
  tabScopedAnnotations: data.annotations.filter(note => /^page:[^:]+:[^*]+$/.test(note.scope)).length,
  globalSections: data.globalSections.length,
  hostMaxDeclaredZIndex: hostZIndexes.length ? Math.max(...hostZIndexes) : 0,
  nativeDialogs: (hostAuditHtml.match(/<dialog\b/gi) || []).length,
  reusedWebMarkdownVendor: hasSharedMarked,
  reusedWebMermaidVendor: hasSharedMermaid,
  updatedExistingFramework: html.includes(CSS_START) && html.includes(RUNTIME_START)
}, null, 2));
