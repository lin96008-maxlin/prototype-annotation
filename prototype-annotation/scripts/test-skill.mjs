import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.dirname(scriptDir);
const testDir = path.join(skillDir, "tests");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "generic-skill-test-"));
const checks = [];

function run(label, args, expectedSuccess = true) {
  const result = spawnSync(process.execPath, args, { cwd: skillDir, encoding: "utf8" });
  const success = result.status === 0;
  const passed = success === expectedSuccess;
  checks.push({ label, passed, exitCode: result.status, output: `${result.stdout || ""}${result.stderr || ""}`.trim().slice(0, 1200) });
  return result;
}

function copyFixture(name, outputName) {
  const target = path.join(tempDir, outputName);
  fs.copyFileSync(path.join(testDir, name), target);
  return target;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function readEmbeddedData(file) {
  const html = fs.readFileSync(file, "utf8");
  const match = html.match(/<script\b[^>]*\bid=["']prototypeAnnotationData["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) throw new Error(`测试文件缺少标注数据：${file}`);
  return JSON.parse(match[1]);
}

function createReviewSession(file, sessionId, updateTitle, { updatePosition = false } = {}) {
  const data = readEmbeddedData(file);
  const prototypeKey = `${data.prototypeId}-${crypto.createHash("sha256").update(path.normalize(path.resolve(file)).toLowerCase()).digest("hex").slice(0, 10)}`;
  const reviewRoot = path.join(path.dirname(file), ".prototype-review", prototypeKey);
  const sessionsDir = path.join(reviewRoot, "sessions");
  fs.mkdirSync(sessionsDir, { recursive: true });
  const now = new Date().toISOString();
  const session = {
    format: "protoWeb-review-session@1",
    prototypeId: data.prototypeId,
    sessionId,
    sourceHtml: path.basename(file),
    baseRevision: Number(data.version) || 1,
    baseHtmlHash: sha256(file),
    status: "draft",
    createdAt: now,
    updatedAt: now,
    operations: [{ entityType: "annotation", action: "update", id: data.annotations[0].id }],
    baseAnnotations: data.annotations,
    baseGlobalMeta: data.globalMeta || {},
    workingGlobalMeta: data.globalMeta || {},
    baseGlobalSections: data.globalSections,
    workingGlobalSections: data.globalSections.map(section => ({ ...section, _editState: "original" })),
    workingAnnotations: data.annotations.map((note, index) => ({
      ...note,
      title: index === 0 ? updateTitle : note.title,
      x: index === 0 && updatePosition
        ? (Number(note.x) >= 0.5 ? Number(note.x) - 0.1 : Number(note.x) + 0.1)
        : note.x,
      _editState: index === 0 ? "modified" : "original",
      _contentPolicy: "direct"
    }))
  };
  fs.writeFileSync(path.join(sessionsDir, `${sessionId}.json`), `${JSON.stringify(session, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(reviewRoot, "manifest.json"), `${JSON.stringify({
    format: "protoWeb-review-manifest@1",
    prototypeId: data.prototypeId,
    prototypeKey,
    sourceHtml: path.basename(file),
    activeSessionId: sessionId,
    sessions: []
  }, null, 2)}\n`, "utf8");
}

for (const relative of [
  "scripts/annotation-quality.mjs",
  "scripts/audit-single-html.mjs",
  "scripts/inject-web-annotations.mjs",
  "scripts/inject-mobile-annotations.mjs",
  "scripts/prototype-annotation-review.mjs",
  "assets/web-annotation/web-annotation-runtime.js",
  "assets/mobile-annotation/mobile-annotation-runtime.js",
  "assets/annotation-editor/prototype-annotation-editor.js"
]) {
  run(`语法：${relative}`, ["--check", path.join(skillDir, relative)]);
}

const webRuntimeSource = fs.readFileSync(path.join(skillDir, "assets/web-annotation/web-annotation-runtime.js"), "utf8");
const mobileRuntimeSource = fs.readFileSync(path.join(skillDir, "assets/mobile-annotation/mobile-annotation-runtime.js"), "utf8");
const sharedEditorSource = fs.readFileSync(path.join(skillDir, "assets/annotation-editor/prototype-annotation-editor.js"), "utf8");
const sharedEditorStyles = fs.readFileSync(path.join(skillDir, "assets/annotation-editor/prototype-annotation-editor.css"), "utf8");
const reviewServerSource = fs.readFileSync(path.join(skillDir, "scripts/prototype-annotation-review.mjs"), "utf8");
const skillSource = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
const editingGuideSource = fs.readFileSync(path.join(skillDir, "references/annotation-editing-guide.md"), "utf8");
const webGuideSource = fs.readFileSync(path.join(skillDir, "references/web-annotation-guide.md"), "utf8");
const mobileGuideSource = fs.readFileSync(path.join(skillDir, "references/mobile-annotation-guide.md"), "utf8");
const metadataBuffer = fs.readFileSync(path.join(skillDir, "agents/openai.yaml"));
let metadataSource = "";
try {
  metadataSource = new TextDecoder("utf-8", { fatal: true }).decode(metadataBuffer);
  checks.push({ label: "Skill 元数据使用合法 UTF-8", passed: true });
} catch (error) {
  checks.push({ label: "Skill 元数据使用合法 UTF-8", passed: false, output: error.message });
}
checks.push({
  label: "Skill 中文界面元数据正确",
  passed: metadataSource.includes('display_name: "原型标注"')
    && metadataSource.includes("$prototype-annotation")
});
checks.push({
  label: "普通标注任务不修改 Skill 自身",
  passed: skillSource.includes("不在普通标注任务中修改当前 Skill")
    && !skillSource.includes("优先修复本技能的通用框架")
});
checks.push({
  label: "编辑服务不引用旧版合并 Skill",
  passed: reviewServerSource.includes("const skillDirectory = path.dirname(scriptDirectory)")
    && !reviewServerSource.includes("single-html-prototype")
});
checks.push({
  label: "日常流程不包含 Skill 回归命令",
  passed: !skillSource.includes("node scripts/test-skill.mjs")
    && !skillSource.includes("完整回归")
});
checks.push({
  label: "首次注入默认只快速检查当前页面",
  passed: webGuideSource.includes("默认只打开当前页面")
    && mobileGuideSource.includes("默认只验证当前页面")
    && skillSource.includes("默认不遍历其他页面和弹层")
});
checks.push({
  label: "编辑服务就绪后不自动演练全流程",
  passed: editingGuideSource.includes("状态为 `ready` 后即可交付")
    && editingGuideSource.includes("不自动演练增删改或多页面跳转")
});
checks.push({
  label: "标注编辑同义请求会直接启动 localhost 服务",
  passed: ["编辑标注", "进入编辑模式", "进入标注编辑模式", "我要编辑标注"]
    .every(phrase => skillSource.includes(phrase) && editingGuideSource.includes(phrase))
    && skillSource.includes("不要只解释操作方法或只返回命令")
});
checks.push({
  label: "标注编辑服务在端口占用时自动寻找可用端口",
  passed: reviewServerSource.includes("function listenOnAvailablePort")
    && reviewServerSource.includes('error?.code !== "EADDRINUSE"')
    && reviewServerSource.includes("const activePort = await listenOnAvailablePort")
    && reviewServerSource.includes("portFallback: activePort !== requestedPort")
    && editingGuideSource.includes("服务自动顺延选择新的可用端口")
});
checks.push({
  label: "Web 展示框架兼容共用业务弹层作用域",
  passed: webRuntimeSource.includes("rememberImplicitOverlayScope")
    && webRuntimeSource.includes("data-proto-route")
    && webRuntimeSource.includes("getImplicitOverlayContext")
});
checks.push({
  label: "共享编辑器复用 Web 弹层作用域判断",
  passed: sharedEditorSource.includes("rememberWebOverlayScope")
    && sharedEditorSource.includes("implicitWebOverlayContext")
});
checks.push({
  label: "共享编辑器复用既有标注顶层且暴露初始化状态",
  passed: sharedEditorSource.includes('document.getElementById("prototypeAnnotationRoot")')
    && sharedEditorSource.includes('document.getElementById("prototypeAnnotationRoot")')
    && sharedEditorSource.includes('dataset.protoEditorRuntimeStatus = "ready"')
});
checks.push({
  label: "共享编辑器按服务配置和通用根节点识别平台",
  passed: reviewServerSource.includes("platform,\n    stableUrl")
    && sharedEditorSource.includes("function detectPlatform()")
    && sharedEditorSource.includes('config.platform === "web" || config.platform === "mobile"')
    && sharedEditorSource.includes('getAttribute("data-proto-platform")')
    && !sharedEditorSource.includes('document.getElementById("prototypeAnnotationData") ? "mobile" : "web"')
});
checks.push({
  label: "展示框架和编辑器使用统一业务属性读取接口",
  passed: webRuntimeSource.includes("node.dataset.protoScope")
    && webRuntimeSource.includes("node.dataset.protoLayer")
    && webRuntimeSource.includes("trigger.dataset.protoRoute")
    && mobileRuntimeSource.includes("node.dataset.protoScope")
    && mobileRuntimeSource.includes("node.dataset.protoLayer")
    && sharedEditorSource.includes("node.dataset.protoScope")
    && sharedEditorSource.includes("node.dataset.protoLayer")
    && sharedEditorSource.includes("trigger.dataset.protoRoute")
    && !/dataset\.(?:protoWebScope|protoWebLayer|protoWebOpenScope|protoMobileScope|protoMobileLayer)\b/.test(`${webRuntimeSource}\n${mobileRuntimeSource}\n${sharedEditorSource}`)
});
checks.push({
  label: "共享编辑器为新增内容生成会话内唯一 ID",
  passed: sharedEditorSource.includes("function createUniqueId")
    && sharedEditorSource.includes('createUniqueId("note"')
    && sharedEditorSource.includes('createUniqueId("section"')
});
checks.push({
  label: "选择新增标注目标时旧圆点不拦截点击",
  passed: sharedEditorStyles.includes("body.proto-editor-selecting .proto-editor-marker")
    && sharedEditorStyles.includes("pointer-events: none !important")
});
checks.push({
  label: "共享编辑器区分圆点单击与真实拖动",
  passed: sharedEditorSource.includes("Math.hypot(dx, dy) <= 8")
    && sharedEditorSource.includes("openNoteDialog(note.id)")
});
checks.push({
  label: "Web 编辑画布随工作台尺寸主动等比居中",
  passed: sharedEditorSource.includes("function fitWebPrototype")
    && sharedEditorSource.includes("new ResizeObserver(scheduleWorkspaceFit).observe(canvas)")
    && sharedEditorSource.includes("scheduleWorkspaceFit();")
});
checks.push({
  label: "移动端编辑器可跨页面打开弹层作用域",
  passed: sharedEditorSource.includes("function findMobileScopeRoute")
    && sharedEditorSource.includes("function invokeKnownPageNavigator")
    && sharedEditorSource.includes('page.closest(".app-page,.page,[data-proto-page]")')
    && sharedEditorSource.includes('camelKey && `#${escapeSelector(camelKey)}Btn`')
});
checks.push({
  label: "Web 编辑器兼容动态页面和多种页面入口",
  passed: sharedEditorSource.includes("function findWebScopeRoute")
    && sharedEditorSource.includes('[data-page="${escapeSelector(pageKey)}"]')
    && sharedEditorSource.includes('const declaredPages = declared.filter')
    && sharedEditorSource.includes('invokeKnownPageNavigator(pageKey, pageNode)')
});
checks.push({
  label: "跨页定位会等待动态页面完成渲染",
  passed: sharedEditorSource.includes("const delays = [0, 80, 220, 500, 900]")
    && sharedEditorSource.includes("if (locateActiveNote(note) || index >= delays.length - 1) return;")
});
checks.push({
  label: "富文本标题与正文使用结构化块切换",
  passed: sharedEditorSource.includes("const applyBlockFormat")
    && sharedEditorSource.includes('replaceBlock(nestedBlock, tagName)')
    && sharedEditorSource.includes('applyBlockFormat("p")')
});
checks.push({
  label: "移动端全部标注分组优先使用业务标题",
  passed: sharedEditorSource.includes('".navbar-title,.nav-title,.page-title,h1,h2"')
    && sharedEditorSource.includes('".drawer-title,.sheet-title,.sheet-head b,.dialog-title,.modal-title,.panel-title,.navbar-title,.nav-title,.page-title,h1,h2"')
    && sharedEditorSource.includes('return `${pageTitle} · 公共`')
});
checks.push({
  label: "Web 与移动端运行时诊断异常小的标注目标",
  passed: webRuntimeSource.includes("undersizedTargetIds")
    && webRuntimeSource.includes("rect.width < 4 || rect.height < 4")
    && mobileRuntimeSource.includes("undersizedTargetIds")
    && mobileRuntimeSource.includes("rect.width < 4 || rect.height < 4")
});
checks.push({
  label: "共享编辑器不暴露弹层技术 scope 名",
  passed: sharedEditorSource.includes("function localizedScopeName")
    && sharedEditorSource.includes('detail: "详情"')
    && sharedEditorSource.includes('tag: "标签"')
    && sharedEditorSource.includes("if (localizedName) return localizedName")
});
checks.push({
  label: "展示框架避免在定位刷新期反复重建交互节点",
  passed: mobileRuntimeSource.includes("if (scopeChanged || notesChanged)")
    && mobileRuntimeSource.includes("scheduleMarkerLayout();")
    && webRuntimeSource.includes("const existingMarkers = new Map")
    && webRuntimeSource.includes("marker.__protoWebNote = note")
    && !webRuntimeSource.includes("function renderMarkers() {\n    markerLayer.replaceChildren();")
});
checks.push({
  label: "Web 浮动圆点直接打开绑定标注并忽略标注层自身动画",
  passed: webRuntimeSource.includes("openNote(boundNote, marker.__protoWebScopeNotes, marker.__protoWebScope)")
    && webRuntimeSource.includes("if (root.contains(event.target)) return;")
    && webRuntimeSource.includes("function isScopeCandidateVisible")
    && webRuntimeSource.includes("isElementVisible(item.node, true)")
    && webRuntimeSource.includes("panelScopeMismatchSince")
    && webRuntimeSource.includes("ensureAnnotationLayer(false);")
});
checks.push({
  label: "编辑写回自动审计并输出增量验证计划",
  passed: reviewServerSource.includes("function runSingleHtmlAudit")
    && reviewServerSource.includes("function buildIncrementalVerificationPlan")
    && reviewServerSource.includes('const mode = geometryOrRouteChanged ? "incremental" : "automatic-only"')
    && !reviewServerSource.includes("framework-smoke")
    && !reviewServerSource.includes("frameworkSignature")
    && reviewServerSource.includes('"incremental"')
    && reviewServerSource.includes("escalateToFullValidationWhen")
});

const webGood = copyFixture("web-annotation-fixture.html", "web-good.html");
run("Web 正常注入", [path.join(scriptDir, "inject-web-annotations.mjs"), webGood]);
const webHash1 = sha256(webGood);
run("Web 重复注入", [path.join(scriptDir, "inject-web-annotations.mjs"), webGood]);
checks.push({ label: "Web 注入幂等", passed: webHash1 === sha256(webGood) });
run("Web 最终单 HTML 审计", [path.join(scriptDir, "audit-single-html.mjs"), webGood]);

const webLegacy = copyFixture("web-annotation-fixture.html", "web-legacy.html");
let webLegacyHtml = fs.readFileSync(webLegacy, "utf8");
webLegacyHtml = webLegacyHtml.replace("</body>", `
<div id="protoWebReviewWorkspace" hidden><div>旧三栏</div></div>
<div id="prototypeAnnotationRoot" popover="manual"><button id="protoWebLauncher">注</button></div>
<script id="protoWebReviewModeRuntime">window.__legacyReview = true;<\/script>
<script>(() => { const prototypeAnnotationData = 1; const protoWebLauncher = 1; function renderMarkers() {} window.__legacyAnnotation = { prototypeAnnotationData, protoWebLauncher, renderMarkers }; })();<\/script>
</body>`);
fs.writeFileSync(webLegacy, webLegacyHtml, "utf8");
run("Web 旧标注框架受控迁移", [path.join(scriptDir, "inject-web-annotations.mjs"), webLegacy, "--migrate-legacy"]);
const migratedWebHtml = fs.readFileSync(webLegacy, "utf8");
checks.push({
  label: "Web 旧框架迁移后只保留一套标准运行时",
  passed: (migratedWebHtml.match(/id=["']prototypeAnnotationRoot["']/g) || []).length === 1
    && (migratedWebHtml.match(/id=["']protoWebWebAnnotationRuntime["']/g) || []).length === 1
    && !migratedWebHtml.includes("__legacyAnnotation")
    && !migratedWebHtml.includes("protoWebReviewModeRuntime")
});

const mobileGood = copyFixture("mobile-annotation-fixture.html", "mobile-good.html");
run("移动端正常注入", [path.join(scriptDir, "inject-mobile-annotations.mjs"), mobileGood]);
const mobileHash1 = sha256(mobileGood);
run("移动端重复注入", [path.join(scriptDir, "inject-mobile-annotations.mjs"), mobileGood]);
checks.push({ label: "移动端注入幂等", passed: mobileHash1 === sha256(mobileGood) });
run("移动端最终单 HTML 审计", [path.join(scriptDir, "audit-single-html.mjs"), mobileGood]);

const webEdit = copyFixture("web-annotation-fixture.html", "web-edit.html");
run("Web 编辑测试前注入", [path.join(scriptDir, "inject-web-annotations.mjs"), webEdit]);
createReviewSession(webEdit, "web-edit-session", "Web 编辑回写验证");
const webApplyResult = run("Web 编辑会话写回并刷新展示框架", [path.join(scriptDir, "prototype-annotation-review.mjs"), "apply", webEdit, "--session", "web-edit-session"]);
const webEditHtml = fs.readFileSync(webEdit, "utf8");
const webApplyPayload = JSON.parse(webApplyResult.stdout);
checks.push({
  label: "Web 编辑写回保留标准展示框架",
  passed: webEditHtml.includes("Web 编辑回写验证")
    && webEditHtml.includes('id="protoWebWebAnnotationRuntime"')
    && (webEditHtml.match(/id=["']prototypeAnnotationRoot["']/g) || []).length === 1
});
checks.push({
  label: "Web 纯内容编辑写回仅执行自动检查",
  passed: webApplyPayload.automaticAudit?.status === "pass"
    && webApplyPayload.verificationPlan?.mode === "automatic-only"
    && webApplyPayload.verificationPlan?.browserChecks?.length === 0
    && webApplyPayload.verificationPlan?.changedAnnotationIds?.length === 1
});

const webPositionEdit = copyFixture("web-annotation-fixture.html", "web-position-edit.html");
run("Web 位置编辑测试前注入", [path.join(scriptDir, "inject-web-annotations.mjs"), webPositionEdit]);
createReviewSession(webPositionEdit, "web-position-session", "Web 位置编辑验证", { updatePosition: true });
const webPositionApplyResult = run("Web 位置编辑保留受影响页面验证", [path.join(scriptDir, "prototype-annotation-review.mjs"), "apply", webPositionEdit, "--session", "web-position-session"]);
const webPositionApplyPayload = JSON.parse(webPositionApplyResult.stdout);
checks.push({
  label: "标注位置变化仍要求验证受影响页面",
  passed: webPositionApplyPayload.verificationPlan?.mode === "incremental"
    && webPositionApplyPayload.verificationPlan?.geometryOrRouteChanged === true
    && webPositionApplyPayload.verificationPlan?.browserChecks?.length === 1
    && webPositionApplyPayload.verificationPlan?.affectedScopes?.length >= 1
});

const mobileEdit = copyFixture("mobile-annotation-fixture.html", "mobile-edit.html");
run("移动端编辑测试前注入", [path.join(scriptDir, "inject-mobile-annotations.mjs"), mobileEdit]);
createReviewSession(mobileEdit, "mobile-edit-session", "移动端编辑回写验证");
const mobileApplyResult = run("移动端编辑会话写回并刷新展示框架", [path.join(scriptDir, "prototype-annotation-review.mjs"), "apply", mobileEdit, "--session", "mobile-edit-session"]);
const mobileEditHtml = fs.readFileSync(mobileEdit, "utf8");
const mobileApplyPayload = JSON.parse(mobileApplyResult.stdout);
checks.push({
  label: "移动端编辑写回保留标准展示框架",
  passed: mobileEditHtml.includes("移动端编辑回写验证")
    && mobileEditHtml.includes('id="protoMobileMobileAnnotationRuntime"')
    && (mobileEditHtml.match(/id=["']prototypeAnnotationRoot["']/g) || []).length === 1
});
checks.push({
  label: "移动端纯内容编辑写回仅执行自动检查",
  passed: mobileApplyPayload.automaticAudit?.status === "pass"
    && mobileApplyPayload.verificationPlan?.mode === "automatic-only"
    && mobileApplyPayload.verificationPlan?.browserChecks?.length === 0
    && mobileApplyPayload.verificationPlan?.changedAnnotationIds?.length === 1
});

const webBad = copyFixture("web-annotation-fixture.html", "web-bad.html");
run("Web 模板化坏标注拦截", [path.join(scriptDir, "inject-web-annotations.mjs"), webBad, path.join(testDir, "web-annotation-template-bad.json")], false);
const webWarning = copyFixture("web-annotation-fixture.html", "web-warning.html");
run("Web warning 严格拦截", [path.join(scriptDir, "inject-web-annotations.mjs"), webWarning, path.join(testDir, "web-annotation-template-warning.json")], false);
const mobileBad = copyFixture("mobile-annotation-fixture.html", "mobile-bad.html");
run("移动端模板化坏标注拦截", [path.join(scriptDir, "inject-mobile-annotations.mjs"), mobileBad, path.join(testDir, "mobile-annotation-template-bad.json")], false);
const mobileLowValue = copyFixture("mobile-annotation-fixture.html", "mobile-low-value.html");
run("移动端低价值标注拦截", [path.join(scriptDir, "inject-mobile-annotations.mjs"), mobileLowValue, path.join(testDir, "mobile-annotation-low-value-bad.json")], false);

const mobileNestedFrame = copyFixture("mobile-annotation-nested-frame-fixture.html", "mobile-nested-frame.html");
run("移动端固定宽度外壳兼容注入", [path.join(scriptDir, "inject-mobile-annotations.mjs"), mobileNestedFrame]);
const mobileNestedHtml = fs.readFileSync(mobileNestedFrame, "utf8");
checks.push({
  label: "移动端审阅层使用 body 全视口挂载",
  passed: mobileNestedHtml.includes("document.body.appendChild(stage)")
    && mobileNestedHtml.includes("position: fixed;")
    && mobileNestedHtml.includes("width: 100vw;")
});
checks.push({
  label: "移动端中宽原型说明进入标注顶层并可诊断",
  passed: mobileNestedHtml.includes("overlayRoot.appendChild(docsPanel)")
    && mobileNestedHtml.includes("stage.insertBefore(docsPanel, docsSplitter || device)")
    && mobileNestedHtml.includes("COMPACT_DOCS_NOT_CLICKABLE")
    && mobileNestedHtml.includes("compactDocsAudit: inspectCompactDocsLayer()")
});
run("移动端固定宽度外壳单 HTML 审计", [path.join(scriptDir, "audit-single-html.mjs"), mobileNestedFrame]);

const missingWebRoot = copyFixture("web-annotation-fixture.html", "missing-web-root.html");
fs.writeFileSync(missingWebRoot, fs.readFileSync(missingWebRoot, "utf8").replace(" data-proto-app", ""), "utf8");
run("Web 缺失业务根节点拦截", [path.join(scriptDir, "inject-web-annotations.mjs"), missingWebRoot], false);
const missingMobileRoot = copyFixture("mobile-annotation-fixture.html", "missing-mobile-root.html");
fs.writeFileSync(missingMobileRoot, fs.readFileSync(missingMobileRoot, "utf8").replace(" data-proto-app", ""), "utf8");
run("移动端缺失业务根节点拦截", [path.join(scriptDir, "inject-mobile-annotations.mjs"), missingMobileRoot], false);

const webWrongPlatform = copyFixture("web-annotation-fixture.html", "web-wrong-platform.html");
fs.writeFileSync(webWrongPlatform, fs.readFileSync(webWrongPlatform, "utf8").replace('data-proto-platform="web"', 'data-proto-platform="mobile"'), "utf8");
run("Web 注入器拦截移动端根节点", [path.join(scriptDir, "inject-web-annotations.mjs"), webWrongPlatform], false);
const webMissingPlatform = copyFixture("web-annotation-fixture.html", "web-missing-platform.html");
fs.writeFileSync(webMissingPlatform, fs.readFileSync(webMissingPlatform, "utf8").replace(' data-proto-platform="web"', ""), "utf8");
run("Web 注入器拦截未声明平台", [path.join(scriptDir, "inject-web-annotations.mjs"), webMissingPlatform], false);
const mobileWrongPlatform = copyFixture("mobile-annotation-fixture.html", "mobile-wrong-platform.html");
fs.writeFileSync(mobileWrongPlatform, fs.readFileSync(mobileWrongPlatform, "utf8").replace('data-proto-platform="mobile"', 'data-proto-platform="web"'), "utf8");
run("移动端注入器拦截 Web 根节点", [path.join(scriptDir, "inject-mobile-annotations.mjs"), mobileWrongPlatform], false);
const mobileMissingPlatform = copyFixture("mobile-annotation-fixture.html", "mobile-missing-platform.html");
fs.writeFileSync(mobileMissingPlatform, fs.readFileSync(mobileMissingPlatform, "utf8").replace(' data-proto-platform="mobile"', ""), "utf8");
run("移动端注入器拦截未声明平台", [path.join(scriptDir, "inject-mobile-annotations.mjs"), mobileMissingPlatform], false);
run("外部资源反例拦截", [path.join(scriptDir, "audit-single-html.mjs"), path.join(testDir, "single-html-external-bad.html")], false);

const failed = checks.filter(check => !check.passed);
console.log(JSON.stringify({
  status: failed.length ? "fail" : "pass",
  tempDir,
  checks: checks.length,
  passed: checks.length - failed.length,
  failed
}, null, 2));
if (failed.length) process.exit(1);
