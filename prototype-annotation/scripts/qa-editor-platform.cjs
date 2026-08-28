const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

const skillDir = path.dirname(__dirname);
const testDir = path.join(skillDir, "tests");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "prototype-annotation-browser-"));
const reviewScript = path.join(skillDir, "scripts", "prototype-annotation-review.mjs");

function prepareFixture(sourceName, outputName, injectorName) {
  const target = path.join(tempDir, outputName);
  fs.copyFileSync(path.join(testDir, sourceName), target);
  const result = spawnSync(process.execPath, [path.join(skillDir, "scripts", injectorName), target], {
    cwd: skillDir,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, `${injectorName} 执行失败：${result.stderr || result.stdout}`);
  return target;
}

function startReviewServer(target, preferredPort) {
  const child = spawn(process.execPath, [reviewScript, "serve", target, "--port", String(preferredPort)], {
    cwd: skillDir,
    stdio: ["ignore", "pipe", "pipe"]
  });
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => reject(new Error(`编辑服务启动超时：${stderr || stdout}`)), 15000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      stdout += chunk;
      const start = stdout.indexOf("{");
      if (start < 0 || !stdout.includes('"editUrl"')) return;
      try {
        const payload = JSON.parse(stdout.slice(start).trim());
        clearTimeout(timer);
        resolve({ child, payload });
      } catch {
        // JSON 仍在分段输出，继续等待。
      }
    });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.once("exit", code => {
      clearTimeout(timer);
      reject(new Error(`编辑服务提前退出（${code}）：${stderr || stdout}`));
    });
  });
}

async function verifyCase(browser, fixture, platform, expectedScope, preferredPort) {
  const server = await startReviewServer(fixture, preferredPort);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  try {
    await page.goto(server.payload.editUrl, { waitUntil: "domcontentloaded" });
    await page.locator('html[data-proto-editor-runtime-status="ready"]').waitFor();
    await page.getByRole("button", { name: /新增标注/ }).waitFor();
    const result = await page.evaluate(() => window.__protoEditorEditor.inspect());
    assert.equal(result.platform, platform, `${platform} 编辑器平台识别错误`);
    assert.equal(result.scope, expectedScope, `${platform} 当前作用域识别错误`);
    assert.ok(result.visibleNoteIds.length > 0, `${platform} 当前作用域没有可见标注`);
    assert.ok(await page.locator(".proto-editor-marker").count() > 0, `${platform} 未渲染标注圆点`);
    assert.deepEqual(pageErrors, [], `${platform} 页面脚本异常：${pageErrors.join("；")}`);
    return {
      platform,
      scope: result.scope,
      visibleNotes: result.visibleNoteIds.length,
      markers: await page.locator(".proto-editor-marker").count(),
      activePort: server.payload.activePort
    };
  } finally {
    await context.close();
    server.child.kill();
  }
}

async function verifyDisplayCase(browser, fixture, platform, expectedScope, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  try {
    await page.goto(pathToFileURL(fixture).href, { waitUntil: "domcontentloaded" });
    const diagnosticsName = platform === "mobile" ? "__prototypeMobileDiagnostics" : "__prototypeWebDiagnostics";
    await page.waitForFunction(name => Boolean(window[name]?.inspect), diagnosticsName);
    const result = await page.evaluate(name => window[name].inspect(), diagnosticsName);
    assert.equal(result.scope, expectedScope, `${platform} 展示运行时作用域识别错误`);
    assert.ok(result.annotationCount > 0, `${platform} 展示运行时没有当前标注`);
    assert.ok(result.annotationAudit.visibleMarkerCount > 0 || result.annotationAudit.markerNodeCount > 0, `${platform} 展示运行时没有标注圆点`);
    assert.deepEqual(result.annotationAudit.invalidTargetIds, [], `${platform} 存在无效标注目标`);
    if (platform === "mobile") {
      const expectedViewportMode = viewport.width < 768 ? "mobile" : "desktop";
      assert.equal(result.viewportMode, expectedViewportMode, `移动端视口模式识别错误（${viewport.width}px）`);
      if (expectedViewportMode === "mobile") {
        assert.equal(result.launcherClickable, true, "手机视口标注入口不可点击");
        const launcher = page.getByRole("button", { name: "打开原型标注菜单" });
        await launcher.click();
        assert.equal(await launcher.getAttribute("aria-expanded"), "true", "手机视口标注菜单未展开");
        await page.getByRole("switch", { name: "显示页面标注" }).click();
        await page.locator(".protoMobile-marker:visible").first().waitFor();
      }
    }
    assert.deepEqual(pageErrors, [], `${platform} 展示运行时脚本异常：${pageErrors.join("；")}`);
    return {
      platform,
      scope: result.scope,
      annotations: result.annotationCount,
      markers: result.annotationAudit.visibleMarkerCount || result.annotationAudit.markerNodeCount,
      viewport: `${viewport.width}x${viewport.height}`
    };
  } finally {
    await context.close();
  }
}

(async () => {
  const webFixture = prepareFixture("web-annotation-fixture.html", "web-editor.html", "inject-web-annotations.mjs");
  const mobileFixture = prepareFixture("mobile-annotation-fixture.html", "mobile-editor.html", "inject-mobile-annotations.mjs");
  const browser = await chromium.launch({ headless: true });
  try {
    const displayResults = [];
    displayResults.push(await verifyDisplayCase(browser, webFixture, "web", "page:one"));
    displayResults.push(await verifyDisplayCase(browser, mobileFixture, "mobile", "page:order:base"));
    displayResults.push(await verifyDisplayCase(browser, mobileFixture, "mobile", "page:order:base", { width: 390, height: 844 }));
    const editorResults = [];
    editorResults.push(await verifyCase(browser, webFixture, "web", "page:one", 19321));
    editorResults.push(await verifyCase(browser, mobileFixture, "mobile", "page:order:base", 19331));
    console.log(JSON.stringify({ status: "pass", tempDir, displayResults, editorResults }, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
