
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATA_SCRIPT_DEFINITIONS = [
  { id: "prototypeAnnotationData", pattern: /(<script\b[^>]*\bid=["']prototypeAnnotationData["'][^>]*>)[\s\S]*?(<\/script>)/i }
];
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillDirectory = path.dirname(scriptDirectory);
const editorDirectory = path.join(skillDirectory, "assets", "annotation-editor");
const editorCssPath = path.join(editorDirectory, "prototype-annotation-editor.css");
const editorJsPath = path.join(editorDirectory, "prototype-annotation-editor.js");
const command = process.argv[2];
const htmlArg = process.argv[3];
const options = parseOptions(process.argv.slice(4));

if (!command || !htmlArg || !["serve", "apply"].includes(command)) {
  printUsage();
  process.exit(1);
}

const htmlPath = path.resolve(htmlArg);
if (!fs.existsSync(htmlPath) || !fs.statSync(htmlPath).isFile()) {
  fail(`找不到原型文件：${htmlPath}`);
}

const initialHtml = fs.readFileSync(htmlPath, "utf8");
const initialPayload = readAnnotationPayload(initialHtml);
const initialData = initialPayload.data;
const prototypeId = safeSegment(initialData.prototypeId || crypto.randomUUID());
const prototypeKey = `${prototypeId}-${sha256(path.normalize(htmlPath).toLowerCase()).slice(0, 10)}`;
const reviewRoot = path.join(path.dirname(htmlPath), ".prototype-review", prototypeKey);
const sessionsDir = path.join(reviewRoot, "sessions");
const manifestPath = path.join(reviewRoot, "manifest.json");

fs.mkdirSync(sessionsDir, { recursive: true });

if (command === "serve") {
  await serveReview();
} else {
  applySession();
}

function parseOptions(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      result[key] = next;
      index += 1;
    } else {
      result[key] = true;
    }
  }
  return result;
}

function printUsage() {
  console.log([
    "用法：",
    "  node prototype-annotation-review.mjs serve <原型.html> [--port <首选端口>]",
    "  node prototype-annotation-review.mjs apply <原型.html> [--session <sessionId>]",
    "",
    "serve：创建独立编辑会话并启动本地预览。",
    "apply：把指定会话写回 HTML；存在多份待处理会话时必须指定 sessionId。"
  ].join("\n"));
}

function fail(message, details) {
  console.error(message);
  if (details) console.error(details);
  process.exit(1);
}

function safeSegment(value) {
  return String(value).trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "prototype";
}

function readAnnotationPayload(html) {
  const definition = DATA_SCRIPT_DEFINITIONS.find(item => item.pattern.test(html));
  if (!definition) fail("HTML 中缺少 #prototypeAnnotationData 标注数据。");
  const match = html.match(definition.pattern);
  const openTagEnd = match[1].length;
  const jsonText = match[0].slice(openTagEnd, match[0].length - match[2].length).trim();
  try {
    return { data: JSON.parse(jsonText), definition };
  } catch (error) {
    fail(`#${definition.id} 不是有效 JSON。`, error.message);
  }
}

function readAnnotationData(html) {
  return readAnnotationPayload(html).data;
}

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function createSessionId() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `${stamp}-${crypto.randomUUID().slice(0, 8)}`;
}

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function updateManifest(session, patch = {}) {
  const manifest = readJson(manifestPath, {
    format: "protoWeb-review-manifest@1",
    prototypeId,
    prototypeKey,
    sourceHtml: path.basename(htmlPath),
    sessions: []
  });
  const summary = {
    sessionId: session.sessionId,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    operationCount: session.operations.length
  };
  const existingIndex = manifest.sessions.findIndex(item => item.sessionId === session.sessionId);
  if (existingIndex >= 0) manifest.sessions[existingIndex] = summary;
  else manifest.sessions.push(summary);
  Object.assign(manifest, patch, { updatedAt: new Date().toISOString() });
  writeJson(manifestPath, manifest);
}

function createReviewSession(html) {
  const payload = readAnnotationPayload(html);
  const data = payload.data;
  const baseHash = sha256(html);
  const sessionId = createSessionId();
  const now = new Date().toISOString();
  const sessionPath = path.join(sessionsDir, `${sessionId}.json`);
  const baseAnnotations = Array.isArray(data.annotations) ? data.annotations : [];
  const baseGlobalSections = Array.isArray(data.globalSections) ? data.globalSections : [];
  const session = {
    format: "protoWeb-review-session@1",
    prototypeId,
    sessionId,
    dataScriptId: payload.definition.id,
    sourceHtml: path.basename(htmlPath),
    baseRevision: Number(data.version) || 1,
    baseHtmlHash: baseHash,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    operations: [],
    baseAnnotations,
    baseGlobalMeta: data.globalMeta || {},
    workingGlobalMeta: data.globalMeta || {},
    baseGlobalSections,
    workingGlobalSections: baseGlobalSections.map(section => ({ ...section, _editState: "original" })),
    workingAnnotations: baseAnnotations.map(note => ({
      ...note,
      _editState: "original",
      _contentPolicy: "direct"
    }))
  };
  writeJson(sessionPath, session);
  updateManifest(session, { activeSessionId: sessionId });
  return { sessionId, sessionPath, baseHash };
}

function injectEditor(html, token) {
  const platform = initialData.mobile ? "mobile" : "web";
  const config = JSON.stringify({
    token,
    apiBase: "/api/review",
    platform,
    stableUrl: `/prototype?protoWeb-mode=edit&protoWeb-token=${token}`
  }).replace(/</g, "\\u003c");
  const headAssets = '<link rel="stylesheet" href="/annotation-editor/editor.css">';
  const bodyAssets = `<script>window.__PROTOTYPE_ANNOTATION_EDITOR_CONFIG__=${config};<\/script><script src="/annotation-editor/editor.js"><\/script>`;
  const bodyOpenIndex = html.search(/<body\b/i);
  const headCloseIndex = bodyOpenIndex >= 0 ? html.toLowerCase().lastIndexOf("</head>", bodyOpenIndex) : -1;
  const withStyles = headCloseIndex >= 0
    ? `${html.slice(0, headCloseIndex)}${headAssets}\n${html.slice(headCloseIndex)}`
    : `${headAssets}\n${html}`;
  const bodyCloseIndex = withStyles.toLowerCase().lastIndexOf("</body>");
  return bodyCloseIndex >= 0
    ? `${withStyles.slice(0, bodyCloseIndex)}${bodyAssets}\n${withStyles.slice(bodyCloseIndex)}`
    : `${withStyles}\n${bodyAssets}`;
}

async function serveReview() {
  if (!fs.existsSync(editorCssPath) || !fs.existsSync(editorJsPath)) {
    fail(`缺少独立标注编辑器资源：${editorDirectory}`);
  }
  const savedManifest = readJson(manifestPath, {});
  const token = String(options.token || savedManifest.reviewToken || crypto.randomBytes(24).toString("hex"));
  let active = createReviewSession(initialHtml);
  updateManifest(readJson(active.sessionPath), { activeSessionId: active.sessionId, reviewToken: token });

  function ensureActiveSession() {
    const currentHtml = fs.readFileSync(htmlPath, "utf8");
    const currentHash = sha256(currentHtml);
    const currentSession = readJson(active.sessionPath);
    const applied = currentSession?.status === "applied";
    const cleanExternalChange = currentSession
      && currentSession.baseHtmlHash !== currentHash
      && currentSession.operations.length === 0;
    if (!currentSession || applied || cleanExternalChange) active = createReviewSession(currentHtml);
    return { active, session: readJson(active.sessionPath), currentHash };
  }

  const requestedPort = Math.max(1024, Math.min(65535, Number(options.port) || 8899));
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
      if (url.pathname === "/favicon.ico") return send(response, 204, "", "text/plain");
      if (url.pathname === "/annotation-editor/editor.css") return send(response, 200, fs.readFileSync(editorCssPath), "text/css; charset=utf-8");
      if (url.pathname === "/annotation-editor/editor.js") return send(response, 200, fs.readFileSync(editorJsPath), "text/javascript; charset=utf-8");
      if (url.pathname === "/api/review/health") {
        const state = ensureActiveSession();
        return sendJson(response, 200, { status: "ok", prototypeId, prototypeKey, sessionId: state.session.sessionId });
      }
      if (url.pathname.startsWith("/api/review/")) {
        if (!isAuthorized(request, url, token)) return sendJson(response, 403, { status: "forbidden" });
        const state = ensureActiveSession();
        if (state.session.baseHtmlHash !== state.currentHash && state.session.operations.length > 0) {
          return sendJson(response, 409, { status: "stale", message: "原型已变化，本轮修改尚未应用" });
        }
        if (url.pathname === "/api/review/status" && request.method === "GET") {
          return sendJson(response, 200, {
            status: state.session.status,
            sessionId: state.session.sessionId,
            updatedAt: state.session.updatedAt
          });
        }
        if (url.pathname === "/api/review/session" && request.method === "GET") {
          return sendJson(response, 200, state.session);
        }
        if (url.pathname === "/api/review/session" && request.method === "PUT") {
          const incoming = await readRequestJson(request, 50 * 1024 * 1024);
          validateSession(incoming, state.session.sessionId, state.session.baseHtmlHash);
          incoming.updatedAt = new Date().toISOString();
          incoming.status = "draft";
          writeJson(state.active.sessionPath, incoming);
          updateManifest(incoming, { activeSessionId: state.session.sessionId });
          return sendJson(response, 200, {
            status: "saved",
            sessionId: state.session.sessionId,
            updatedAt: incoming.updatedAt,
            operationCount: incoming.operations.length
          });
        }
        return sendJson(response, 404, { status: "not-found" });
      }
      const isEditorPreview = (url.pathname === "/prototype" && url.searchParams.get("protoWeb-mode") === "edit")
        || url.pathname === "/edit"
        || url.pathname === "/";
      if (isEditorPreview) {
        if (!isAuthorized(request, url, token)) return send(response, 403, "编辑链接无效", "text/plain; charset=utf-8");
        ensureActiveSession();
        return send(response, 200, injectEditor(fs.readFileSync(htmlPath, "utf8"), token), "text/html; charset=utf-8");
      }
      if (url.pathname === "/prototype") {
        return send(response, 200, fs.readFileSync(htmlPath), "text/html; charset=utf-8");
      }
      return send(response, 404, "Not Found", "text/plain; charset=utf-8");
    } catch (error) {
      console.error("审阅服务请求处理失败", error);
      if (!response.headersSent) sendJson(response, 500, { status: "error", message: error.message });
      else response.end();
    }
  });

  const activePort = await listenOnAvailablePort(server, requestedPort);
  server.on("error", error => console.error(`审阅服务运行异常：${error.message}`));
  const editUrl = `http://127.0.0.1:${activePort}/prototype?protoWeb-mode=edit&protoWeb-token=${token}`;
  console.log(JSON.stringify({
    status: "ready",
    prototypeId,
    sessionId: active.sessionId,
    sessionFile: active.sessionPath,
    requestedPort,
    activePort,
    portFallback: activePort !== requestedPort,
    editUrl
  }, null, 2));
}

async function listenOnAvailablePort(server, preferredPort) {
  const maximumAttempts = 200;
  let port = preferredPort;
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    try {
      await listenOnPort(server, port);
      return port;
    } catch (error) {
      if (error?.code !== "EADDRINUSE") throw error;
      port = port >= 65535 ? 1024 : port + 1;
    }
  }
  throw new Error(`从端口 ${preferredPort} 开始未找到可用端口`);
}

function listenOnPort(server, port) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      server.off("listening", handleListening);
      server.off("error", handleError);
    };
    const handleListening = () => {
      cleanup();
      resolve();
    };
    const handleError = error => {
      cleanup();
      reject(error);
    };
    server.once("listening", handleListening);
    server.once("error", handleError);
    server.listen(port, "127.0.0.1");
  });
}

function isAuthorized(request, url, expectedToken) {
  return request.headers["x-protoWeb-token"] === expectedToken
    || url.searchParams.get("token") === expectedToken
    || url.searchParams.get("protoWeb-token") === expectedToken;
}

function validateSession(value, expectedSessionId, expectedHash) {
  if (!value || value.format !== "protoWeb-review-session@1") throw new Error("会话格式无效");
  if (value.prototypeId !== prototypeId || value.sessionId !== expectedSessionId) throw new Error("会话与当前原型不匹配");
  if (value.baseHtmlHash !== expectedHash) throw new Error("会话基线与当前 HTML 不匹配");
  if (!Array.isArray(value.operations) || !Array.isArray(value.workingAnnotations)) throw new Error("会话缺少标注数据");
  if (!Array.isArray(value.workingGlobalSections)) throw new Error("会话缺少原型说明数据");
}

function readRequestJson(request, maximumBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", chunk => {
      size += chunk.length;
      if (size > maximumBytes) {
        reject(new Error("保存内容超过 50MB 限制"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(new Error("请求 JSON 无效"));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, value) {
  send(response, statusCode, `${JSON.stringify(value)}\n`, "application/json; charset=utf-8");
}

function send(response, statusCode, body, contentType) {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(body);
}

function refreshAnnotationFramework(platform) {
  if (!skillDirectory) throw new Error("找不到当前原型标注 Skill 目录，无法刷新标注展示框架");
  const injectorName = platform === "mobile" ? "inject-mobile-annotations.mjs" : "inject-web-annotations.mjs";
  const injectorPath = path.join(skillDirectory, "scripts", injectorName);
  if (!fs.existsSync(injectorPath)) throw new Error(`找不到标注注入器：${injectorPath}`);
  const args = [injectorPath, htmlPath, "--allow-quality-warnings"];
  if (platform === "web") args.push("--migrate-legacy");
  const result = spawnSync(process.execPath, args, {
    cwd: skillDirectory,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `注入器退出码 ${result.status}`).trim());
  }
  const refreshedHtml = fs.readFileSync(htmlPath, "utf8");
  const runtimeId = platform === "mobile" ? "protoMobileMobileAnnotationRuntime" : "protoWebWebAnnotationRuntime";
  if (!new RegExp(`id=["']${runtimeId}["']`).test(refreshedHtml)) {
    throw new Error(`标注展示框架刷新后缺少 #${runtimeId}`);
  }
  return { html: refreshedHtml, output: result.stdout.trim() };
}

function runSingleHtmlAudit() {
  const auditPath = path.join(skillDirectory, "scripts", "audit-single-html.mjs");
  const result = spawnSync(process.execPath, [auditPath, htmlPath], {
    cwd: skillDirectory,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `单 HTML 审计退出码 ${result.status}`).trim());
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`单 HTML 审计输出无法解析：${error.message}`);
  }
}

function buildIncrementalVerificationPlan(session, nextData) {
  const operations = Array.isArray(session.operations) ? session.operations : [];
  const annotationOperations = operations.filter(item => item.entityType === "annotation");
  const sectionOperations = operations.filter(item => item.entityType === "global-section");
  const changedAnnotationIds = Array.from(new Set(annotationOperations.map(item => item.id).filter(Boolean)));
  const changedGlobalSectionIds = Array.from(new Set(sectionOperations.map(item => item.id).filter(Boolean)));
  const baseById = new Map((session.baseAnnotations || []).map(note => [note.id, note]));
  const nextById = new Map((nextData.annotations || []).map(note => [note.id, note]));
  const affectedScopes = new Set();
  let geometryOrRouteChanged = false;

  annotationOperations.forEach(operation => {
    const before = baseById.get(operation.id);
    const after = nextById.get(operation.id);
    if (before?.scope) affectedScopes.add(before.scope);
    if (after?.scope) affectedScopes.add(after.scope);
    if (operation.action === "add" || operation.action === "delete") {
      geometryOrRouteChanged = true;
      return;
    }
    if (["scope", "target", "x", "y", "scroll"].some(key => JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]))) {
      geometryOrRouteChanged = true;
    }
  });

  const mode = geometryOrRouteChanged ? "incremental" : "automatic-only";
  const browserChecks = [];
  if (changedAnnotationIds.length && geometryOrRouteChanged) {
    browserChecks.push("只打开受影响 scope，核对变更标注的目标、圆点位置、列表编号和单击详情。"
    );
  }

  return {
    mode,
    reason: geometryOrRouteChanged
      ? "存在定位类变化，只验证本轮受影响 scope。"
      : operations.length
        ? "仅有内容变化，自动检查通过后无需浏览器复查。"
        : "本轮无内容变更，自动检查通过后无需浏览器复查。",
    changedAnnotationIds,
    affectedScopes: Array.from(affectedScopes),
    changedGlobalSectionIds,
    geometryOrRouteChanged,
    browserChecks,
    escalateToFullValidationWhen: [
      "自动质量门禁或单 HTML 审计失败",
      "受影响 scope 无法到达、目标不存在或圆点与列表不一致",
      "受影响 scope 检查发现跨页面或框架级回归"
    ]
  };
}

function applySession() {
  const sessionFiles = fs.readdirSync(sessionsDir)
    .filter(name => name.endsWith(".json"))
    .map(name => path.join(sessionsDir, name));
  const pending = sessionFiles
    .map(file => ({ file, data: readJson(file) }))
    .filter(item => item.data && path.basename(item.file) === `${item.data.sessionId}.json`)
    .filter(item => item.data && ["draft", "pending"].includes(item.data.status));
  const manifest = readJson(manifestPath, {});
  let selected;
  if (options.session) selected = pending.find(item => item.data.sessionId === options.session);
  else if (manifest.activeSessionId) selected = pending.find(item => item.data.sessionId === manifest.activeSessionId);
  else if (pending.length === 1) selected = pending[0];
  else if (pending.length > 1) {
    fail("存在多份待处理编辑会话，请使用 --session 指定。", pending.map(item => `${item.data.sessionId}（${item.data.operations.length} 项操作）`).join("\n"));
  }
  if (!selected) fail(options.session ? `找不到待处理会话：${options.session}` : "没有待处理的标注编辑会话。");

  const currentHtml = fs.readFileSync(htmlPath, "utf8");
  if (sha256(currentHtml) !== selected.data.baseHtmlHash) {
    fail("当前 HTML 已发生变化，本轮标注基于旧版本，禁止直接应用。", `sessionId: ${selected.data.sessionId}`);
  }

  const pendingPolish = selected.data.workingAnnotations.filter(note =>
    note._editState !== "deleted" && note._contentPolicy === "ai-polish" && !String(note._aiContent || "").trim()
  );
  if (pendingPolish.length) {
    fail("存在尚未由 AI 润色的标注，需先补充 _aiContent 后再应用。", pendingPolish.map(note => `${note.id}：${note.title}`).join("\n"));
  }

  const currentPayload = readAnnotationPayload(currentHtml);
  const platform = currentPayload.data.mobile ? "mobile" : "web";
  const nextData = currentPayload.data;
  nextData.globalMeta = selected.data.workingGlobalMeta || nextData.globalMeta || {};
  nextData.globalSections = selected.data.workingGlobalSections.map(section => {
    const clean = { ...section };
    delete clean._editState;
    return clean;
  });
  nextData.annotations = selected.data.workingAnnotations
    .filter(note => note._editState !== "deleted")
    .map(note => {
      const clean = { ...note };
      if (clean._contentPolicy === "ai-polish") {
        clean.content = clean._aiContent;
        clean.format = clean._aiFormat || "markdown";
      }
      delete clean._editState;
      delete clean._contentPolicy;
      delete clean._aiContent;
      delete clean._aiFormat;
      delete clean._route;
      return clean;
    });
  nextData.version = (Number(nextData.version) || 1) + 1;
  nextData.reviewRevision = selected.data.sessionId;
  const serialized = JSON.stringify(nextData, null, 2).replace(/<\/script/gi, "<\\/script");
  const nextHtml = currentHtml.replace(currentPayload.definition.pattern, (full, open, close) => `${open}\n${serialized}\n  ${close}`);
  fs.writeFileSync(htmlPath, nextHtml, "utf8");
  let refreshed;
  let audit;
  try {
    refreshed = refreshAnnotationFramework(platform);
    audit = runSingleHtmlAudit();
  } catch (error) {
    fs.writeFileSync(htmlPath, currentHtml, "utf8");
    fail("标注数据已回滚：自动刷新或审计失败。", error.message);
  }

  const verificationPlan = buildIncrementalVerificationPlan(selected.data, nextData);

  selected.data.status = "applied";
  selected.data.appliedAt = new Date().toISOString();
  selected.data.updatedAt = selected.data.appliedAt;
  selected.data.resultHtmlHash = sha256(refreshed.html);
  selected.data.verificationPlan = verificationPlan;
  writeJson(selected.file, selected.data);
  updateManifest(selected.data, { activeSessionId: null, latestAppliedSessionId: selected.data.sessionId });
  console.log(JSON.stringify({
    status: "applied",
    prototypeId,
    sessionId: selected.data.sessionId,
    annotationCount: nextData.annotations.length,
    html: htmlPath,
    frameworkRefreshed: true,
    automaticAudit: {
      status: audit.status,
      issueCount: audit.issueCount,
      duplicateIds: audit.duplicateIds.length
    },
    verificationPlan,
    resultHtmlHash: selected.data.resultHtmlHash
  }, null, 2));
}
