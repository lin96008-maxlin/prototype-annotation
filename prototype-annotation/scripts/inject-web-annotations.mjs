import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeAnnotationQuality, attributeValuesOnMarkedElements, countElementsWithAttribute } from "./annotation-quality.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.dirname(scriptDir);
const assetDir = path.join(skillDir, "assets", "web-annotation");
const cliArgs = process.argv.slice(2);
const migrateLegacy = cliArgs.includes("--migrate-legacy");
const allowQualityWarnings = cliArgs.includes("--allow-quality-warnings");
const positionalArgs = cliArgs.filter(arg => !arg.startsWith("--"));
const targetArg = positionalArgs[0];
const dataArg = positionalArgs[1];

if (!targetArg) {
  console.error("用法：node inject-web-annotations.mjs <目标HTML> [标注数据JSON] [--migrate-legacy]");
  process.exit(1);
}

const targetPath = path.resolve(targetArg);
if (!fs.existsSync(targetPath)) {
  console.error(`目标 HTML 不存在：${targetPath}`);
  process.exit(1);
}

const CSS_START = "<!-- PROTO_WEB_WEB_ANNOTATION_CSS_START -->";
const CSS_END = "<!-- PROTO_WEB_WEB_ANNOTATION_CSS_END -->";
const UI_START = "<!-- PROTO_WEB_WEB_ANNOTATION_UI_START -->";
const UI_END = "<!-- PROTO_WEB_WEB_ANNOTATION_UI_END -->";
const RUNTIME_START = "<!-- PROTO_WEB_WEB_ANNOTATION_RUNTIME_START -->";
const RUNTIME_END = "<!-- PROTO_WEB_WEB_ANNOTATION_RUNTIME_END -->";

const readAsset = name => fs.readFileSync(path.join(assetDir, name), "utf8").trim();
const css = readAsset("web-annotation.css");
const shell = readAsset("web-annotation-shell.html");
const runtime = readAsset("web-annotation-runtime.js");
const marked = readAsset("marked.umd.js").replace(/^\/\/# sourceMappingURL=.*$/gm, "");
const mermaid = readAsset("mermaid.min.js");
const markedLicense = readAsset("marked-LICENSE");
const mermaidLicense = readAsset("mermaid-LICENSE");

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

function removeElementById(html, id) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const openingPattern = new RegExp(`<([a-zA-Z][\\w:-]*)\\b[^>]*\\bid=["']${escapedId}["'][^>]*>`, "i");
  const opening = openingPattern.exec(html);
  if (!opening) return { html, removed: false };
  const tagName = opening[1];
  const tokenPattern = new RegExp(`<\\/?${tagName}\\b[^>]*>`, "gi");
  tokenPattern.lastIndex = opening.index;
  let depth = 0;
  let token;
  while ((token = tokenPattern.exec(html))) {
    const closing = /^<\//.test(token[0]);
    const selfClosing = /\/>$/.test(token[0]);
    if (closing) depth -= 1;
    else if (!selfClosing) depth += 1;
    if (depth === 0) {
      return {
        html: html.slice(0, opening.index) + html.slice(tokenPattern.lastIndex),
        removed: true
      };
    }
  }
  throw new Error(`旧版标注元素未闭合：#${id}`);
}

function removeLegacyAnonymousRuntimes(source) {
  let removedAnonymousRuntime = 0;
  const html = source.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (full, attributes, content) => {
    if (/\bid\s*=/.test(attributes)) return full;
    const legacyRuntime = content.includes("prototypeAnnotationData")
      && content.includes("protoWebLauncher")
      && content.includes("renderMarkers");
    if (!legacyRuntime) return full;
    removedAnonymousRuntime += 1;
    return "";
  });
  return { html, removedAnonymousRuntime };
}

function migrateLegacyFramework(source) {
  let migrated = source;
  const removedIds = [];
  for (const id of [
    "protoWebReviewWorkspace",
    "prototypeAnnotationRoot",
    "protoWebReviewModeRuntime",
    "protoWebWebAnnotationRuntime",
    "protoWebMarkedVendor",
    "protoWebMermaidVendor",
    "protoWebWebAnnotationStyles"
  ]) {
    const result = removeElementById(migrated, id);
    migrated = result.html;
    if (result.removed) removedIds.push(id);
  }
  const anonymousCleanup = removeLegacyAnonymousRuntimes(migrated);
  migrated = anonymousCleanup.html;
  if (!removedIds.includes("prototypeAnnotationRoot")) throw new Error("旧版 Web 标注迁移失败：找不到 #prototypeAnnotationRoot");
  return { html: migrated, removedIds, removedAnonymousRuntime: anonymousCleanup.removedAnonymousRuntime };
}

function wrapBodyContentsAsAppRoot(source) {
  const bodyOpen = /<body\b[^>]*>/i.exec(source);
  const bodyCloseIndex = source.toLowerCase().lastIndexOf("</body>");
  if (!bodyOpen || bodyCloseIndex < bodyOpen.index) throw new Error("旧版 Web 标注迁移失败：HTML body 不完整");
  const contentStart = bodyOpen.index + bodyOpen[0].length;
  return source.slice(0, contentStart)
    + '\n<div data-proto-app data-proto-platform="web" style="width:100%;min-height:100%;">'
    + source.slice(contentStart, bodyCloseIndex)
    + "\n</div>\n"
    + source.slice(bodyCloseIndex);
}

function validateData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("标注数据必须是 JSON 对象");
  if (!Array.isArray(data.annotations)) throw new Error("标注数据缺少 annotations 数组");
  if (!Array.isArray(data.globalSections)) throw new Error("标注数据缺少 globalSections 数组");
  if (data.review !== undefined) {
    if (!data.review || typeof data.review !== "object" || Array.isArray(data.review)) throw new Error("review 必须是对象");
    for (const field of ["designWidth", "designHeight"]) {
      if (data.review[field] !== undefined && (!Number.isFinite(Number(data.review[field])) || Number(data.review[field]) <= 0)) {
        throw new Error(`review.${field} 必须是正数`);
      }
    }
  }

  const annotationIds = new Set();
  for (const note of data.annotations) {
    if (!note.id || !note.scope || !note.target || !note.title) throw new Error("每条页面标注必须包含 id、scope、target、title");
    if (typeof note.content !== "string") throw new Error(`页面标注 ${note.id} 的 content 必须是字符串`);
    if (!Number.isFinite(Number(note.x)) || Number(note.x) < 0 || Number(note.x) > 1) throw new Error(`页面标注 ${note.id} 的 x 必须在 0–1 之间`);
    if (!Number.isFinite(Number(note.y)) || Number(note.y) < 0 || Number(note.y) > 1) throw new Error(`页面标注 ${note.id} 的 y 必须在 0–1 之间`);
    if (annotationIds.has(note.id)) throw new Error(`页面标注 id 重复：${note.id}`);
    annotationIds.add(note.id);
  }

  const sectionIds = new Set();
  for (const section of data.globalSections) {
    if (!section.id || !section.title || typeof section.content !== "string") throw new Error("每个全局说明栏目必须包含 id、title、content");
    if (sectionIds.has(section.id)) throw new Error(`全局说明栏目 id 重复：${section.id}`);
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
const sourceExistingData = readExistingData(html);
let migrationReport = null;
if (/\bid=["']prototypeAnnotationRoot["']/i.test(html) && !html.includes(UI_START)) {
  if (!migrateLegacy) {
    throw new Error("目标 HTML 已存在未受区块标记管理的 prototypeAnnotationRoot；确认来源后使用 --migrate-legacy 迁移");
  }
  const migration = migrateLegacyFramework(html);
  html = migration.html;
  migrationReport = {
    removedIds: migration.removedIds,
    removedAnonymousRuntime: migration.removedAnonymousRuntime
  };
  if (countElementsWithAttribute(html, "data-proto-app") === 0) {
    html = wrapBodyContentsAsAppRoot(html);
    migrationReport.wrappedAppRoot = true;
  }
}
const anonymousRuntimeCleanup = removeLegacyAnonymousRuntimes(html);
html = anonymousRuntimeCleanup.html;

let suppliedData = null;
if (dataArg) {
  const dataPath = path.resolve(dataArg);
  suppliedData = validateData(JSON.parse(fs.readFileSync(dataPath, "utf8")));
}

const currentExistingData = readExistingData(html);
const existingData = currentExistingData || sourceExistingData;
const hostAuditHtml = [[CSS_START, CSS_END], [UI_START, UI_END], [RUNTIME_START, RUNTIME_END]]
  .reduce((source, [start, end]) => removeManagedBlock(source, start, end), html);
const hostZIndexes = Array.from(hostAuditHtml.matchAll(/z-index\s*:\s*(-?\d+)/gi), match => Number(match[1])).filter(Number.isFinite);
const hostMaxDeclaredZIndex = hostZIndexes.length ? Math.max(...hostZIndexes) : 0;
const nativeDialogs = (hostAuditHtml.match(/<dialog\b/gi) || []).length;
const reviewAppRoots = countElementsWithAttribute(hostAuditHtml, "data-proto-app");
const reviewPortalRoots = countElementsWithAttribute(hostAuditHtml, "data-proto-portal");
if (reviewAppRoots !== 1) throw new Error(`Web 业务根节点 data-proto-app 必须且只能有一个，当前发现 ${reviewAppRoots} 个`);
const reviewPlatforms = attributeValuesOnMarkedElements(hostAuditHtml, "data-proto-app", "data-proto-platform");
if (reviewPlatforms[0] !== "web") {
  throw new Error(`Web 业务根节点必须声明 data-proto-platform="web"，当前为 ${reviewPlatforms[0] || "未声明"}`);
}
const reviewModeContract = "standard";
const data = suppliedData || existingData?.data || validateData({
  prototypeId: path.basename(targetPath, path.extname(targetPath)),
  version: 1,
  globalMeta: { name: "原型说明", version: "V0.1", updatedAt: new Date().toISOString().slice(0, 10) },
  globalSections: [],
  annotations: []
});
const qualityReport = analyzeAnnotationQuality(data, { platform: "web" });
if (qualityReport.status !== "pass" && !(allowQualityWarnings && qualityReport.status === "warning")) {
  console.error(JSON.stringify({ annotationQuality: qualityReport }, null, 2));
  throw new Error(`Web 标注质量检查未通过（${qualityReport.status}），已停止注入；请修复上方报告中的全部问题`);
}
const dataScript = `<script id="prototypeAnnotationData" type="application/json">\n${JSON.stringify(data, null, 2)}\n</script>`;

if (currentExistingData) {
  html = html.replace(currentExistingData.match, () => dataScript);
}

const cssBlock = `${CSS_START}\n<style id="protoWebWebAnnotationStyles">\n${css}\n</style>\n${CSS_END}`;
html = replaceBlock(html, CSS_START, CSS_END, cssBlock, "</head>");

const uiBlock = `${UI_START}\n${shell}\n${UI_END}`;
html = replaceBlock(html, UI_START, UI_END, uiBlock, "</body>");

if (!currentExistingData) {
  const uiEndIndex = html.indexOf(UI_END) + UI_END.length;
  html = html.slice(0, uiEndIndex) + `\n${dataScript}` + html.slice(uiEndIndex);
}

const licenseNotices = [
  licenseComment("Marked", markedLicense),
  licenseComment("Mermaid", mermaidLicense)
].join("\n");
const runtimeBlock = `${RUNTIME_START}\n${licenseNotices}\n<script id="protoWebMarkedVendor">${escapeScriptEnd(marked)}</script>\n<script id="protoWebMermaidVendor">${escapeScriptEnd(mermaid)}</script>\n<script id="protoWebWebAnnotationRuntime">\n${escapeScriptEnd(runtime)}\n</script>\n${RUNTIME_END}`;
html = replaceBlock(html, RUNTIME_START, RUNTIME_END, runtimeBlock, "</body>");

const counts = {
  root: (html.match(/id=["']prototypeAnnotationRoot["']/g) || []).length,
  data: (html.match(/id=["']prototypeAnnotationData["']/g) || []).length,
  runtime: (html.match(/id=["']protoWebWebAnnotationRuntime["']/g) || []).length
};
if (counts.root !== 1 || counts.data !== 1 || counts.runtime !== 1) {
  throw new Error(`注入结果数量异常：${JSON.stringify(counts)}`);
}

fs.writeFileSync(targetPath, html, "utf8");
console.log(JSON.stringify({
  target: targetPath,
  bytes: Buffer.byteLength(html),
  annotations: data.annotations.length,
  globalSections: data.globalSections.length,
  annotationQuality: qualityReport,
  qualityWarningsAccepted: allowQualityWarnings && qualityReport.status === "warning",
  hostMaxDeclaredZIndex,
  nativeDialogs,
  reviewModeContract,
  reviewAppRoots,
  reviewPortalRoots,
  migratedLegacyFramework: Boolean(migrationReport),
  migrationReport,
  removedLegacyAnonymousRuntimes: anonymousRuntimeCleanup.removedAnonymousRuntime,
  updatedExistingFramework: html.includes(CSS_START) && html.includes(RUNTIME_START)
}, null, 2));
