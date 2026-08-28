import fs from "node:fs";
import path from "node:path";

const targetArg = process.argv[2];
if (!targetArg) {
  console.error("用法：node audit-single-html.mjs <目标HTML>");
  process.exit(1);
}

const targetPath = path.resolve(targetArg);
if (!fs.existsSync(targetPath)) {
  console.error(`目标 HTML 不存在：${targetPath}`);
  process.exit(1);
}

const html = fs.readFileSync(targetPath, "utf8");
if (!/<\/?html\b/i.test(html) || !/<\/head>/i.test(html) || !/<\/body>/i.test(html)) {
  throw new Error("目标文件不是完整 HTML 文档");
}

const issues = [];

function report(code, message, value = "") {
  issues.push({ code, message, value });
}

function isEmbeddedResource(value) {
  const source = String(value || "").trim();
  return source.startsWith("data:") || source.startsWith("#") || source === "about:blank";
}

function inspectResourceValue(value, context) {
  const source = String(value || "").trim();
  if (!source || isEmbeddedResource(source)) return;
  report("EXTERNAL_RESOURCE", `${context} 必须内嵌为 data URI`, source.slice(0, 180));
}

function inspectCss(css, context) {
  const importPattern = /@import\s+(?:url\(\s*)?["']?([^"'\s);]+)["']?\s*\)?/gi;
  for (const match of css.matchAll(importPattern)) inspectResourceValue(match[1], `${context} @import`);
  const urlPattern = /url\(\s*(["']?)(.*?)\1\s*\)/gi;
  for (const match of css.matchAll(urlPattern)) inspectResourceValue(match[2], `${context} url()`);
}

function inspectRichText(value, context) {
  const markdownImagePattern = /!\[[^\]]*]\(\s*<?([^\s)>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g;
  for (const match of value.matchAll(markdownImagePattern)) inspectResourceValue(match[1], `${context} Markdown 图片`);
  const htmlAssetPattern = /<(?:img|source|video|audio|track|iframe|object|embed)\b[^>]*\b(?:src|srcset|poster|data)\s*=\s*(["'])(.*?)\1/gi;
  for (const match of value.matchAll(htmlAssetPattern)) inspectResourceValue(match[2], `${context} HTML 资源`);
  inspectCss(value, `${context} 富文本样式`);
}

function walkStrings(value, visitor, pathParts = []) {
  if (typeof value === "string") {
    visitor(value, pathParts.join("."));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkStrings(item, visitor, [...pathParts, String(index)]));
    return;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => walkStrings(item, visitor, [...pathParts, key]));
  }
}

for (const id of ["prototypeAnnotationData"]) {
  const pattern = new RegExp(`<script\\b(?=[^>]*\\bid=["']${id}["'])[^>]*>([\\s\\S]*?)<\\/script\\s*>`, "i");
  const match = html.match(pattern);
  if (!match) continue;
  try {
    const data = JSON.parse(match[1]);
    walkStrings(data, (value, dataPath) => inspectRichText(value, `${id}.${dataPath}`));
  } catch (error) {
    report("INVALID_ANNOTATION_JSON", `${id} 不是合法 JSON`, error.message);
  }
}

const htmlWithoutComments = html.replace(/<!--[\s\S]*?-->/g, "");
const htmlWithoutScriptBodies = htmlWithoutComments.replace(/(<script\b[^>]*>)[\s\S]*?(<\/script\s*>)/gi, "$1$2");
const styleBlocks = Array.from(htmlWithoutComments.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi));
styleBlocks.forEach((match, index) => inspectCss(match[1], `style[${index + 1}]`));

const tagText = htmlWithoutScriptBodies.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "");
const tags = tagText.match(/<(?![!/?])[a-z][^>]*>/gi) || [];
const resourceAttributes = {
  script: ["src"],
  link: ["href"],
  img: ["src", "srcset"],
  source: ["src", "srcset"],
  video: ["src", "poster"],
  audio: ["src"],
  track: ["src"],
  iframe: ["src"],
  object: ["data"],
  embed: ["src"],
  input: ["src"],
  base: ["href"]
};
const ids = [];
for (const tag of tags) {
  const tagName = tag.match(/^<\s*([a-z0-9-]+)/i)?.[1]?.toLowerCase();
  if (!tagName) continue;
  const id = tag.match(/\bid\s*=\s*(["'])(.*?)\1/i)?.[2];
  if (id) ids.push(id);
  for (const attribute of resourceAttributes[tagName] || []) {
    const match = tag.match(new RegExp(`\\b${attribute}\\s*=\\s*(["'])(.*?)\\1`, "i"));
    if (!match) continue;
    const srcset = match[2].trim();
    const values = attribute === "srcset" && !srcset.startsWith("data:")
      ? srcset.split(",").map(item => item.trim().split(/\s+/)[0])
      : [srcset];
    values.forEach(value => inspectResourceValue(value, `<${tagName}> ${attribute}`));
  }
  const inlineStyle = tag.match(/\bstyle\s*=\s*(["'])(.*?)\1/i)?.[2];
  if (inlineStyle) inspectCss(inlineStyle, `<${tagName}> style`);
}

const duplicateIds = Array.from(ids.reduce((counts, id) => counts.set(id, (counts.get(id) || 0) + 1), new Map()).entries())
  .filter(([, count]) => count > 1)
  .map(([id, count]) => ({ id, count }));
duplicateIds.forEach(item => report("DUPLICATE_ID", `HTML id 重复 ${item.count} 次`, item.id));

const result = {
  target: targetPath,
  status: issues.length ? "fail" : "pass",
  bytes: Buffer.byteLength(html),
  webAnnotations: ids.includes("prototypeAnnotationRoot"),
  mobileAnnotations: ids.includes("protoMobileStage"),
  duplicateIds,
  issueCount: issues.length,
  issues
};

console.log(JSON.stringify(result, null, 2));
if (issues.length) process.exit(1);
