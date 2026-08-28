import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const skillRoot = path.resolve(process.argv[2] || path.dirname(scriptDir));
const currentSkillName = "prototype-annotation";
const textExtensions = new Set([".md", ".yaml", ".yml", ".json", ".js", ".mjs", ".cjs", ".css", ".html"]);
const ignoredNames = new Set(["marked.umd.js", "mermaid.min.js"]);
const ignoredDirectories = new Set([".git", "node_modules", ".prototype-review"]);

const forbiddenTokens = [
  ["high", "fidelity", "prototype", "ant", "design"].join("-"),
  ["zartui", "high", "fidelity", "prototype"].join("-"),
  ["zartui", "prototype", "annotation"].join("-"),
  ["single", "html", "prototype"].join("-"),
  ["product", "manual", "authoring"].join("-"),
  ["source", "to", "user", "manual"].join("-"),
  ["prd", "outputs"].join("-"),
  ["ui", "ux", "pro", "max"].join("-"),
  ["make", "interfaces", "feel", "better"].join("-"),
  "通用设计系统 Skill",
  "高保真原型技能"
];

function collectFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (ignoredDirectories.has(entry.name)) return [];
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(absolute);
    if (!entry.isFile() || ignoredNames.has(entry.name)) return [];
    return textExtensions.has(path.extname(entry.name).toLowerCase()) ? [absolute] : [];
  });
}

function lineNumber(source, index) {
  return source.slice(0, index).split("\n").length;
}

const issues = [];
const scannedFiles = collectFiles(skillRoot).filter(file => path.resolve(file) !== path.resolve(scriptPath));
const allowedActionPrefixes = ["data-", "proto-", "mobile-", "web-"];
const allowedActionTokens = new Set(["z-index", "nth-child", "nth-of-type", "data-uri", "content-type"]);

for (const file of scannedFiles) {
  const relativePath = path.relative(skillRoot, file);
  const source = fs.readFileSync(file, "utf8");

  for (const match of source.matchAll(/\$([a-z][a-z0-9-]*)/gi)) {
    if (match[1] === currentSkillName) continue;
    issues.push({
      code: "EXTERNAL_SKILL_INVOCATION",
      file: relativePath,
      line: lineNumber(source, match.index),
      value: `$${match[1]}`
    });
  }

  for (const token of forbiddenTokens) {
    const index = source.toLowerCase().indexOf(token.toLowerCase());
    if (index < 0) continue;
    issues.push({
      code: "KNOWN_EXTERNAL_SKILL_REFERENCE",
      file: relativePath,
      line: lineNumber(source, index),
      value: token
    });
  }

  const externalRoot = /(?:\.codex|\.agents)[\\/]+skills[\\/]/i.exec(source);
  if (externalRoot) {
    issues.push({
      code: "EXTERNAL_SKILL_PATH",
      file: relativePath,
      line: lineNumber(source, externalRoot.index),
      value: externalRoot[0]
    });
  }

  for (const match of source.matchAll(/(?:使用|调用|改用|转交(?:给)?|路由到)\s*`?\$?([a-z][a-z0-9]*(?:-[a-z0-9]+)+)`?/giu)) {
    const candidate = match[1].toLowerCase();
    if (candidate === currentSkillName
      || allowedActionTokens.has(candidate)
      || allowedActionPrefixes.some(prefix => candidate.startsWith(prefix))) continue;
    issues.push({
      code: "POSSIBLE_EXTERNAL_SKILL_ROUTE",
      file: relativePath,
      line: lineNumber(source, match.index),
      value: match[0]
    });
  }
}

const result = {
  status: issues.length ? "fail" : "pass",
  skillRoot,
  scannedFiles: scannedFiles.length,
  issueCount: issues.length,
  issues
};

console.log(JSON.stringify(result, null, 2));
if (issues.length) process.exit(1);
