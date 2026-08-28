(function () {
  "use strict";

  const config = window.__PROTOTYPE_ANNOTATION_EDITOR_CONFIG__ || {};
  if (!config.token || !config.apiBase) return;

  function detectPlatform() {
    if (config.platform === "web" || config.platform === "mobile") return config.platform;
    const declared = document.querySelector("[data-proto-app]")?.getAttribute("data-proto-platform");
    if (declared === "web" || declared === "mobile") return declared;
    return document.getElementById("protoMobileStage") ? "mobile" : "web";
  }

  const state = {
    platform: detectPlatform(),
    session: null,
    adapter: null,
    scope: "",
    scopeLabel: "当前页面",
    viewRange: "current",
    filter: "all",
    selectedDocId: "",
    editingDoc: false,
    editingDocNewId: "",
    editingNoteId: "",
    editingNewNote: null,
    selectingTarget: false,
    selectionContext: null,
    hoverTarget: null,
    draggingMarker: null,
    workspace: null,
    idSequence: 0,
    saveTimer: 0,
    contextFrame: 0,
    workspaceFitFrame: 0,
    contextRefreshUntil: 0,
    lastDrawerType: "",
    lastWebOverlayScope: "",
    lastWebOverlayKind: "",
    lastSessionUpdate: ""
  };

  const transientKeys = new Set([
    "_editState",
    "_contentPolicy",
    "_aiContent",
    "_aiFormat",
    "_route"
  ]);

  const icons = {
    close: "&#215;",
    edit: "&#9998;",
    image: "&#9638;",
    table: "&#9638;",
    code: "&lt;/&gt;",
    mermaid: "&#9671;"
  };

  function api(path, options) {
    const separator = path.includes("?") ? "&" : "?";
    return fetch(`${config.apiBase}${path}${separator}token=${encodeURIComponent(config.token)}`, {
      cache: "no-store",
      ...options,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ...(options && options.headers ? options.headers : {})
      }
    }).then(async response => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(body.message || `请求失败（${response.status}）`), { status: response.status });
      return body;
    });
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function cleanEntity(value) {
    const next = {};
    Object.entries(value || {}).forEach(([key, item]) => {
      if (!transientKeys.has(key)) next[key] = item;
    });
    return next;
  }

  function comparable(value) {
    return JSON.stringify(cleanEntity(value));
  }

  function createUniqueId(prefix, existingItems) {
    const existingIds = new Set((existingItems || []).map(item => String(item.id || "")));
    let candidate = "";
    do {
      state.idSequence += 1;
      const randomPart = globalThis.crypto && typeof globalThis.crypto.randomUUID === "function"
        ? globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 10)
        : Math.random().toString(16).slice(2, 12);
      candidate = `${prefix}-${Date.now().toString(36)}-${state.idSequence.toString(36)}-${randomPart}`;
    } while (existingIds.has(candidate));
    return candidate;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeSelector(value) {
    if (window.CSS && typeof CSS.escape === "function") return CSS.escape(String(value));
    return String(value).replace(/[^a-zA-Z0-9_-]/g, character => `\\${character}`);
  }

  function safeQuery(root, selector) {
    try {
      return root && selector ? root.querySelector(selector) : null;
    } catch (error) {
      return null;
    }
  }

  function safeQueryUnique(root, selector) {
    try {
      const matches = root && selector ? root.querySelectorAll(selector) : [];
      return matches.length === 1 ? matches[0] : null;
    } catch (error) {
      return null;
    }
  }

  function mobileScopeNode(appRoot, noteScope, context) {
    if (context && matchesScope(noteScope, context.scope)) return context.scopeNode;
    const nodes = Array.from(appRoot.querySelectorAll("[data-proto-scope]"));
    const exact = nodes.find(node => node.dataset.protoScope === noteScope);
    if (exact) return exact;
    if (!String(noteScope).startsWith("page:")) return null;
    const pageKey = String(noteScope).split(":")[1];
    return nodes.find(node => {
      const scope = String(node.dataset.protoScope || "");
      return scope.startsWith("page:") && scope.split(":")[1] === pageKey;
    }) || null;
  }

  function webScopeNode(noteScope, context) {
    if (context && matchesScope(noteScope, context.scope)) return context.scopeNode;
    if (!String(noteScope).startsWith("page:")) return null;
    const exact = safeQuery(state.adapter?.businessRoot || document,
      `[data-proto-scope="${escapeSelector(noteScope)}"]`);
    if (exact) return exact;
    return document.getElementById(`page-${String(noteScope).split(":")[1]}`);
  }

  function targetInScope(root, selector, fallbackRoot) {
    const scoped = safeQuery(root, selector);
    if (scoped) return scoped;
    return safeQueryUnique(fallbackRoot, selector);
  }

  function isRenderable(node) {
    if (!node || !node.isConnected) return false;
    let current = node;
    while (current && current !== document.documentElement) {
      const style = getComputedStyle(current);
      if (current.hidden || current.getAttribute("aria-hidden") === "true") return false;
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
      current = current.parentElement;
    }
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function annotationBoxTarget(node) {
    if (!node) return null;
    if (isRenderable(node)) return node;
    let current = node.parentElement;
    while (current && current !== state.adapter?.businessRoot && current !== document.body) {
      if (isRenderable(current)) return current;
      current = current.parentElement;
    }
    const visibleChildren = Array.from(node.querySelectorAll("*")).filter(isRenderable);
    if (visibleChildren.length) {
      visibleChildren.sort((a, b) => {
        const aRect = a.getBoundingClientRect();
        const bRect = b.getBoundingClientRect();
        return bRect.width * bRect.height - aRect.width * aRect.height;
      });
      return visibleChildren[0];
    }
    return null;
  }

  function matchesScope(noteScope, scope) {
    if (noteScope === scope) return true;
    if (!scope.startsWith("page:")) return false;
    if (noteScope === "page:*") return true;
    const scopeParts = scope.split(":");
    return scopeParts.length >= 3 && noteScope === `${scopeParts.slice(0, 2).join(":")}:*`;
  }

  function normalizeHtml(raw, format) {
    const value = String(raw || "").trim();
    if (!value) return "";
    if (/<\/?[a-z][\s\S]*>/i.test(value)) return sanitizeHtml(value);
    if (format === "markdown" && window.marked && typeof window.marked.parse === "function") {
      return sanitizeHtml(window.marked.parse(value));
    }
    return `<p>${escapeHtml(value).replace(/\n/g, "<br>")}</p>`;
  }

  function noteContentSummary(note) {
    const template = document.createElement("template");
    template.innerHTML = normalizeHtml(note.content, note.format);
    template.content.querySelectorAll("br").forEach(node => node.replaceWith(" "));
    template.content.querySelectorAll("p,div,li,tr,h1,h2,h3,h4,h5,h6,pre,blockquote").forEach(node => node.append(" "));
    return String(template.content.textContent || "").replace(/\s+/g, " ").trim();
  }

  function sanitizeHtml(raw) {
    const template = document.createElement("template");
    template.innerHTML = String(raw || "");
    template.content.querySelectorAll("script,style,iframe,object,embed,form").forEach(node => node.remove());
    template.content.querySelectorAll("*").forEach(node => {
      Array.from(node.attributes).forEach(attribute => {
        const name = attribute.name.toLowerCase();
        const value = attribute.value.trim().toLowerCase();
        if (name.startsWith("on") || name === "style" || ((name === "href" || name === "src") && value.startsWith("javascript:"))) {
          node.removeAttribute(attribute.name);
        }
      });
    });
    return template.innerHTML;
  }

  function hasBrokenText(value) {
    const text = String(value || "");
    return text.includes("�") || /\?{4,}/.test(text);
  }

  function createToolbar(editor, options = {}) {
    const toolbar = document.createElement("div");
    toolbar.className = "proto-editor-toolbar";
    toolbar.innerHTML = `
      <button type="button" data-command="undo" title="撤销">↶</button>
      <button type="button" data-command="redo" title="重做">↷</button>
      <span class="proto-editor-toolbar-divider"></span>
      <select data-block-format title="段落格式" aria-label="段落格式">
        <option value="p">正文</option>
        <option value="h2">一级标题</option>
        <option value="h3">二级标题</option>
        <option value="blockquote">引用</option>
      </select>
      <button type="button" data-command="bold" title="加粗"><strong>B</strong></button>
      <button type="button" data-command="italic" title="斜体"><em>I</em></button>
      <button type="button" data-command="underline" title="下划线"><u>U</u></button>
      <button type="button" data-command="strikeThrough" title="删除线"><s>S</s></button>
      <span class="proto-editor-toolbar-divider"></span>
      <button type="button" data-command="insertUnorderedList" title="无序列表">&#8226;</button>
      <button type="button" data-command="insertOrderedList" title="有序列表">1.</button>
      <button type="button" data-command="outdent" title="减少缩进">←</button>
      <button type="button" data-command="indent" title="增加缩进">→</button>
      <span class="proto-editor-toolbar-divider"></span>
      <button type="button" data-command="justifyLeft" title="左对齐">≡</button>
      <button type="button" data-command="justifyCenter" title="居中对齐">≣</button>
      <button type="button" data-command="justifyRight" title="右对齐">≡</button>
      <button type="button" data-action="link" title="添加链接">链</button>
      <button type="button" data-command="unlink" title="取消链接">断</button>
      <span class="proto-editor-toolbar-divider"></span>
      <button type="button" data-insert="table" title="表格">${icons.table}</button>
      <button type="button" data-insert="inline-code" title="行内代码">&lt;&gt;</button>
      <button type="button" data-insert="code" title="代码块">${icons.code}</button>
      <button type="button" data-insert="mermaid" title="Mermaid 流程图">M</button>
      <button type="button" data-command="insertHorizontalRule" title="分隔线">—</button>
      <label title="插入图片">${icons.image}<input type="file" accept="image/*"></label>
      <button type="button" data-action="clear" title="清除格式">清</button>
      ${options.aiToggle ? '<button class="proto-editor-ai-toggle" type="button" role="switch" aria-checked="false">AI 润色</button>' : ""}
    `;

    const blockSelect = toolbar.querySelector("[data-block-format]");
    let savedRange = null;
    const rememberSelection = () => {
      const selection = window.getSelection();
      if (!selection || !selection.rangeCount) return;
      const range = selection.getRangeAt(0);
      if (editor.contains(range.commonAncestorContainer)) savedRange = range.cloneRange();
    };
    const restoreSelection = () => {
      editor.focus();
      if (!savedRange) return;
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(savedRange);
    };
    const refreshBlockSelect = () => {
      const selection = window.getSelection();
      let node = selection?.anchorNode;
      if (node?.nodeType === Node.TEXT_NODE) node = node.parentElement;
      const block = node?.closest?.("h2,h3,blockquote,p,div,li");
      const tag = block?.tagName?.toLowerCase();
      blockSelect.value = ["h2", "h3", "blockquote"].includes(tag) ? tag : "p";
    };
    const runCommand = (command, value = null) => {
      restoreSelection();
      document.execCommand(command, false, value);
      rememberSelection();
      refreshBlockSelect();
    };
    const insertHtml = html => {
      restoreSelection();
      document.execCommand("insertHTML", false, html);
      rememberSelection();
    };
    const selectBlockContents = block => {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(block);
      selection.removeAllRanges();
      selection.addRange(range);
      savedRange = range.cloneRange();
      refreshBlockSelect();
    };
    const replaceBlock = (block, tagName) => {
      if (!block || block.tagName.toLowerCase() === tagName) {
        if (block) selectBlockContents(block);
        return block;
      }
      const replacement = document.createElement(tagName);
      while (block.firstChild) replacement.appendChild(block.firstChild);
      block.replaceWith(replacement);
      selectBlockContents(replacement);
      return replacement;
    };
    const applyBlockFormat = tagName => {
      restoreSelection();
      const selection = window.getSelection();
      let node = selection && selection.anchorNode;
      if (node?.nodeType === Node.TEXT_NODE) node = node.parentElement;
      if (!node || !editor.contains(node)) return;
      const listItem = node.closest("li");
      if (listItem && editor.contains(listItem)) {
        const nestedBlock = node.closest("h2,h3,blockquote,p");
        if (nestedBlock && listItem.contains(nestedBlock)) {
          replaceBlock(nestedBlock, tagName);
        } else {
          const block = document.createElement(tagName);
          while (listItem.firstChild) block.appendChild(listItem.firstChild);
          listItem.appendChild(block);
          selectBlockContents(block);
        }
        return;
      }
      const currentBlock = node.closest("h2,h3,blockquote,p,div");
      if (currentBlock && currentBlock !== editor && editor.contains(currentBlock)) {
        replaceBlock(currentBlock, tagName);
        return;
      }
      runCommand("formatBlock", tagName);
    };

    ["mouseup", "keyup", "focus", "input"].forEach(type => editor.addEventListener(type, () => {
      rememberSelection();
      refreshBlockSelect();
    }));
    toolbar.addEventListener("mousedown", event => {
      rememberSelection();
      if (event.target.closest("button")) event.preventDefault();
    });
    toolbar.addEventListener("click", event => {
      const button = event.target.closest("button");
      if (!button || button.classList.contains("proto-editor-ai-toggle")) return;
      if (button.dataset.command) runCommand(button.dataset.command);
      if (button.dataset.action === "link") {
        const href = window.prompt("请输入链接地址", "https://");
        if (href) runCommand("createLink", href);
      }
      if (button.dataset.action === "clear") {
        runCommand("removeFormat");
        applyBlockFormat("p");
      }
      if (button.dataset.insert === "table") {
        insertHtml("<table><thead><tr><th>字段</th><th>说明</th></tr></thead><tbody><tr><td>示例</td><td>填写内容</td></tr></tbody></table><p><br></p>");
      }
      if (button.dataset.insert === "inline-code") {
        insertHtml("<code>代码</code>");
      }
      if (button.dataset.insert === "code") {
        insertHtml("<pre><code>// 在此填写代码</code></pre><p><br></p>");
      }
      if (button.dataset.insert === "mermaid") {
        insertHtml("<pre><code class=\"language-mermaid\">flowchart LR\n  A[开始] --&gt; B[结束]</code></pre><p><br></p>");
      }
    });
    blockSelect.addEventListener("mousedown", rememberSelection);
    blockSelect.addEventListener("change", () => applyBlockFormat(blockSelect.value));
    toolbar.querySelector("input[type=file]").addEventListener("change", event => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) return alert("请选择图片文件。");
      const reader = new FileReader();
      reader.onload = () => {
        insertHtml(`<img src="${reader.result}" alt="标注插图"><p><br></p>`);
      };
      reader.readAsDataURL(file);
      event.target.value = "";
    });
    return toolbar;
  }

  function createRichEditor(content, format, placeholder) {
    const editor = document.createElement("div");
    editor.className = "proto-editor-rich-editor";
    editor.contentEditable = "true";
    editor.dataset.placeholder = placeholder || "填写内容";
    editor.innerHTML = normalizeHtml(content, format);
    editor.dataset.initialHtml = sanitizeHtml(editor.innerHTML).trim();
    return editor;
  }

  function rememberWebOverlayScope(target) {
    const trigger = target?.closest?.("[data-proto-route],[data-drawer],[data-modal],[data-dialog]");
    if (!trigger) return;
    let scope = trigger.dataset.protoRoute || "";
    let kind = "";
    if (scope.includes(":")) {
      kind = scope.split(":", 1)[0];
    } else if (trigger.dataset.drawer) {
      kind = "drawer";
      scope = `drawer:${trigger.dataset.drawer}`;
    } else if (trigger.dataset.modal) {
      kind = "modal";
      scope = `modal:${trigger.dataset.modal}`;
    } else if (trigger.dataset.dialog) {
      kind = "modal";
      scope = `modal:${trigger.dataset.dialog}`;
    }
    if (!scope || !kind) return;
    state.lastWebOverlayScope = scope;
    state.lastWebOverlayKind = kind;
    if (kind === "drawer") state.lastDrawerType = scope.split(":").slice(1).join(":");
  }

  function implicitWebOverlayContext() {
    if (!state.lastWebOverlayScope) return null;
    const selectors = state.lastWebOverlayKind === "drawer"
      ? ".drawer-overlay.open,.drawer.open,[data-drawer-overlay].open,[data-drawer-overlay][aria-hidden='false']"
      : ".modal-overlay.open,.dialog-overlay.open,.modal.open,.dialog.open,[role='dialog'][aria-modal='true']";
    const overlays = Array.from(document.querySelectorAll(selectors)).filter(isRenderable);
    if (!overlays.length) return null;
    overlays.sort((a, b) => {
      const zA = Number.parseInt(getComputedStyle(a).zIndex, 10) || 0;
      const zB = Number.parseInt(getComputedStyle(b).zIndex, 10) || 0;
      return zA - zB || (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    });
    const overlay = overlays[overlays.length - 1];
    const panelSelector = state.lastWebOverlayKind === "drawer"
      ? ".drawer,[role='dialog'],aside"
      : "[role='dialog'],.modal,.dialog";
    const panel = Array.from(overlay.querySelectorAll(panelSelector)).find(isRenderable);
    const title = (panel || overlay).querySelector(".drawer-title,.modal-title,.dialog-title,h1,h2")?.textContent.trim();
    return {
      scope: state.lastWebOverlayScope,
      scopeNode: panel || overlay,
      label: `${state.lastWebOverlayKind === "drawer" ? "抽屉" : "弹窗"} · ${title || state.lastWebOverlayScope.split(":").slice(1).join(":")}`
    };
  }

  function createAdapter() {
    if (state.platform === "mobile") {
      const stage = document.querySelector(".protoMobile-stage");
      const appRoot = document.querySelector("[data-proto-app]");
      return {
        platform: "mobile",
        stage,
        appRoot,
        businessRoot: appRoot,
        leftPanel: document.getElementById("protoMobileDocsPanel") || document.querySelector(".protoMobile-docs-panel"),
        leftHeader: document.querySelector(".protoMobile-docs-panel .protoMobile-panel-header"),
        docsNav: document.getElementById("protoMobileDocNav"),
        docsBody: document.getElementById("protoMobileDocContent"),
        rightPanel: document.querySelector(".protoMobile-notes-panel"),
        getContext() {
          const candidates = Array.from(appRoot.querySelectorAll("[data-proto-scope]"))
            .map((node, index) => ({ node, index, scope: node.dataset.protoScope, layer: Number(node.dataset.protoLayer) || 0 }))
            .filter(item => item.scope && isRenderable(item.node));
          if (appRoot.matches("[data-proto-scope]") && isRenderable(appRoot)) {
            candidates.unshift({ node: appRoot, index: -1, scope: appRoot.dataset.protoScope, layer: Number(appRoot.dataset.protoLayer) || 0 });
          }
          candidates.sort((a, b) => a.layer - b.layer || a.index - b.index);
          const current = candidates[candidates.length - 1] || { node: appRoot, scope: "page:default" };
          const title = current.node.querySelector("h1,h2,.navbar-title,.nav-title,.page-title")?.textContent.trim();
          const activeTab = current.scope.split(":").length >= 3
            ? current.node.querySelector('[role="tab"].is-active,.tabs-bar .tab-item.is-active')?.textContent.trim()
            : "";
          const label = title && activeTab ? `${title} · ${activeTab}` : title;
          return { scope: current.scope, scopeNode: current.node, label: label || current.scope.replace(/^(page|sheet|dialog):/, "") };
        },
        findTarget(note, context) {
          const scopeNode = mobileScopeNode(appRoot, note.scope, context);
          return targetInScope(scopeNode, note.target, appRoot);
        }
      };
    }

    const workspace = document.getElementById("protoWebReviewWorkspace");
    const appRoot = document.getElementById("protoWebReviewPrototypeFrame") || document.body;
    return {
      platform: "web",
      stage: workspace,
      appRoot,
      businessRoot: appRoot,
      leftPanel: document.querySelector(".protoWeb-review-left"),
      leftHeader: document.querySelector(".protoWeb-review-left .protoWeb-review-side-header"),
      docsNav: document.getElementById("protoWebReviewDocsNav"),
      docsBody: document.getElementById("protoWebReviewDocsBody"),
      rightPanel: document.querySelector(".protoWeb-review-right"),
      getContext() {
        const declared = Array.from(appRoot.querySelectorAll("[data-proto-scope]"))
          .map((node, index) => ({
            node,
            index,
            scope: node.dataset.protoScope,
            layer: Number(node.dataset.protoLayer) || 0
          }))
          .filter(item => item.scope && isRenderable(item.node));
        const declaredOverlays = declared.filter(item => item.layer > 0 || !item.scope.startsWith("page:"));
        if (declaredOverlays.length) {
          declaredOverlays.sort((a, b) => a.layer - b.layer || a.index - b.index);
          const current = declaredOverlays[declaredOverlays.length - 1];
          const title = current.node.querySelector(".drawer-title,.modal-title,.dialog-title,h1,h2")?.textContent.trim();
          return {
            scope: current.scope,
            scopeNode: current.node,
            label: `${current.scope.startsWith("drawer:") ? "抽屉" : "弹窗"} · ${title || current.scope.split(":").slice(1).join(":")}`
          };
        }
        const implicitOverlay = implicitWebOverlayContext();
        if (implicitOverlay) return implicitOverlay;
        const declaredPages = declared.filter(item => item.scope.startsWith("page:"));
        if (declaredPages.length) {
          declaredPages.sort((a, b) => a.layer - b.layer || a.index - b.index);
          const current = declaredPages[declaredPages.length - 1];
          const label = current.node.dataset.title
            || current.node.querySelector(".page-title,h1,h2")?.childNodes[0]?.textContent.trim()
            || current.scope.replace(/^page:/, "");
          return { scope: current.scope, scopeNode: current.node, label };
        }
        const page = document.querySelector(".page.active");
        const scope = page ? `page:${page.id.replace(/^page-/, "")}` : "page:dashboard";
        const label = document.querySelector(".nav-leaf.active")?.textContent.trim()
          || document.querySelector(".tab-item.active,.work-tab.active")?.textContent.trim()
          || page?.querySelector(".page-title")?.childNodes[0]?.textContent.trim()
          || scope.replace(/^page:/, "");
        return { scope, scopeNode: page || appRoot, label };
      },
      findTarget(note, context) {
        const scopeNode = webScopeNode(note.scope, context);
        return targetInScope(scopeNode, note.target, document);
      }
    };
  }

  function ensureWebReviewMode() {
    if (state.platform !== "web") return Promise.resolve();
    const openButton = document.getElementById("protoWebOpenReview");
    if (!document.body.classList.contains("protoWeb-review-mode") && openButton) openButton.click();
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  function workspaceLayoutStorageKey() {
    const id = state.session?.prototypeId || document.title || location.port || "prototype";
    return `prototype-annotation-editor:workspace-widths:${id}`;
  }

  function readWorkspaceLayout() {
    try {
      return JSON.parse(localStorage.getItem(workspaceLayoutStorageKey()) || "{}");
    } catch (error) {
      return {};
    }
  }

  function saveWorkspaceLayout() {
    if (!state.workspace) return;
    const { stage, widths } = state.workspace;
    localStorage.setItem(workspaceLayoutStorageKey(), JSON.stringify({
      shellVersion: 2,
      left: Math.round(widths.left),
      right: Math.round(widths.right),
      leftCollapsed: stage.classList.contains("proto-editor-left-collapsed"),
      rightCollapsed: stage.classList.contains("proto-editor-right-collapsed")
    }));
    stage.classList.remove("is-resizing");
  }

  function fitMobileDevice() {
    if (state.platform !== "mobile" || !state.workspace) return;
    const { canvas, device } = state.workspace;
    const width = Math.max(1, device.offsetWidth);
    const height = Math.max(1, device.offsetHeight);
    const scale = Math.max(.35, Math.min(1, (canvas.clientWidth - 24) / width, (canvas.clientHeight - 24) / height));
    device.style.setProperty("--proto-editor-device-scale", String(scale));
    scheduleContextUpdate();
  }

  function fitWebPrototype() {
    if (state.platform !== "web" || !state.workspace) return;
    const { canvas } = state.workspace;
    const frame = document.getElementById("protoWebReviewPrototypeFrame");
    if (!canvas || !frame) return;
    const width = Math.max(1, frame.offsetWidth || Number.parseFloat(frame.style.width) || 1920);
    const height = Math.max(1, frame.offsetHeight || Number.parseFloat(frame.style.height) || 1080);
    const margin = 16;
    const scale = Math.min(
      Math.max(1, canvas.clientWidth - margin * 2) / width,
      Math.max(1, canvas.clientHeight - margin * 2) / height
    );
    const left = Math.round((canvas.clientWidth - width * scale) / 2);
    const top = Math.round((canvas.clientHeight - height * scale) / 2);
    frame.style.transform = `translate(${left}px, ${top}px) scale(${scale})`;
    frame.dataset.scale = scale.toFixed(4);
    scheduleContextUpdate(true);
  }

  function scheduleWorkspaceFit() {
    if (state.workspaceFitFrame) return;
    state.workspaceFitFrame = requestAnimationFrame(() => {
      state.workspaceFitFrame = 0;
      if (state.platform === "mobile") fitMobileDevice();
      else fitWebPrototype();
    });
  }

  function setWorkspacePanelWidth(side, value) {
    if (!state.workspace) return;
    const { stage, leftPanel, rightPanel } = state.workspace;
    const panel = side === "left" ? leftPanel : rightPanel;
    const otherPanel = side === "left" ? rightPanel : leftPanel;
    const minimum = side === "left" ? 280 : 300;
    const canvasMinimum = 360;
    const hardMaximum = side === "left" ? 960 : 820;
    const maximum = Math.max(minimum, Math.min(hardMaximum,
      stage.clientWidth - otherPanel.getBoundingClientRect().width - canvasMinimum - 16));
    const width = Math.max(minimum, Math.min(maximum, Number(value) || minimum));
    stage.style.setProperty(side === "left" ? "--proto-editor-left-width" : "--proto-editor-right-width", `${width}px`);
    state.workspace.widths[side] = width;
    panel.dataset.protoEditorWidth = String(width);
    scheduleWorkspaceFit();
  }

  function bindWorkspaceSplitter(splitter, side) {
    if (!splitter) return;
    splitter.classList.add("proto-editor-workspace-splitter", `proto-editor-workspace-splitter-${side}`);
    splitter.tabIndex = 0;
    const startResize = event => {
      if (event.button != null && event.button !== 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const panel = side === "left" ? state.workspace.leftPanel : state.workspace.rightPanel;
      const startX = event.clientX;
      const startWidth = panel.getBoundingClientRect().width;
      const pointerId = event.pointerId;
      state.workspace.stage.classList.add("is-resizing");
      splitter.classList.add("is-dragging");

      const move = moveEvent => {
        if (moveEvent.pointerId !== pointerId) return;
        const delta = moveEvent.clientX - startX;
        setWorkspacePanelWidth(side, startWidth + (side === "left" ? delta : -delta));
      };
      const end = endEvent => {
        if (endEvent.pointerId !== pointerId) return;
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", end, true);
        window.removeEventListener("pointercancel", end, true);
        splitter.classList.remove("is-dragging");
        saveWorkspaceLayout();
        scheduleWorkspaceFit();
      };
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", end, true);
      window.addEventListener("pointercancel", end, true);
    };
    splitter.addEventListener("pointerdown", startResize, true);
    splitter.addEventListener("keydown", event => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const panel = side === "left" ? state.workspace.leftPanel : state.workspace.rightPanel;
      const direction = event.key === "ArrowRight" ? 1 : -1;
      setWorkspacePanelWidth(side, panel.getBoundingClientRect().width + direction * (side === "left" ? 16 : -16));
      saveWorkspaceLayout();
    }, true);
  }

  function setPanelCollapsed(side, collapsed) {
    if (!state.workspace) return;
    const { stage } = state.workspace;
    stage.classList.toggle(`proto-editor-${side}-collapsed`, collapsed);
    document.querySelectorAll(`[data-proto-editor-collapse="${side}"]`).forEach(button => button.setAttribute("aria-expanded", String(!collapsed)));
    saveWorkspaceLayout();
    scheduleWorkspaceFit();
    scheduleContextUpdate();
  }

  function createPanelRail(side, label) {
    const panel = side === "left" ? state.adapter.leftPanel : state.adapter.rightPanel;
    let rail = panel.querySelector(`.proto-editor-panel-rail-${side}`);
    if (rail) return rail;
    rail = document.createElement("div");
    rail.className = `proto-editor-panel-rail proto-editor-panel-rail-${side}`;
    rail.innerHTML = `<button class="proto-editor-icon-button" type="button" data-proto-editor-expand="${side}" title="展开${label}" aria-label="展开${label}">${side === "left" ? "›" : "‹"}</button><span>${label}</span>`;
    rail.querySelector("button").addEventListener("click", () => setPanelCollapsed(side, false));
    panel.appendChild(rail);
    return rail;
  }

  function installSharedWorkspace() {
    const { stage, leftPanel, rightPanel } = state.adapter;
    const isMobile = state.platform === "mobile";
    const device = isMobile ? document.getElementById("protoMobileDevice") || stage.querySelector(".protoMobile-device") : null;
    const leftSplitter = document.getElementById(isMobile ? "protoMobileDocsSplitter" : "protoWebReviewSplitterLeft")
      || stage.querySelector(isMobile ? ".protoMobile-desktop-splitter" : ".protoWeb-review-splitter-left");
    let rightSplitter = document.getElementById("protoWebReviewSplitterRight") || stage.querySelector(".proto-editor-workspace-splitter-right");
    if (!leftSplitter || (isMobile && !device)) throw new Error("原型缺少画板或分隔条，无法建立统一编辑工作台。");

    stage.classList.remove("no-docs", "is-left-collapsed", "is-right-collapsed");
    stage.classList.add("proto-editor-shared-workspace");
    leftPanel.classList.add("proto-editor-workspace-left", "protoWeb-review-side", "protoWeb-review-left");
    rightPanel.classList.add("proto-editor-workspace-right", "protoWeb-review-side", "protoWeb-review-right");
    state.adapter.leftHeader?.classList.add("protoWeb-review-side-header");
    state.adapter.docsNav?.classList.add("protoWeb-review-docs-nav");
    state.adapter.docsBody?.classList.add("protoWeb-review-docs-body", "protoWeb-content");
    state.adapter.docsNav?.parentElement?.classList.add("protoWeb-review-docs-main");

    let center = isMobile ? stage.querySelector(".proto-editor-workspace-center") : stage.querySelector(".protoWeb-review-center");
    let canvas = isMobile ? center?.querySelector(".proto-editor-workspace-canvas") : center?.querySelector(".protoWeb-review-canvas");
    if (isMobile && !center) {
      center = document.createElement("section");
      center.className = "protoWeb-review-center proto-editor-workspace-center";
      center.innerHTML = `
        <header class="protoWeb-review-toolbar"><span class="protoWeb-review-scope" id="protoEditorWorkspaceScope">当前页面</span></header>
        <div class="protoWeb-review-canvas proto-editor-workspace-canvas" aria-label="原型画布"></div>
      `;
      canvas = center.querySelector(".proto-editor-workspace-canvas");
      stage.insertBefore(center, device);
      canvas.appendChild(device);
    }

    if (!rightSplitter) {
      rightSplitter = document.createElement("div");
      rightSplitter.className = "proto-editor-workspace-splitter proto-editor-workspace-splitter-right";
      rightSplitter.setAttribute("role", "separator");
      rightSplitter.setAttribute("aria-label", "调整标注编辑宽度");
      rightSplitter.setAttribute("aria-orientation", "vertical");
      stage.insertBefore(rightSplitter, rightPanel);
    }

    const stored = readWorkspaceLayout();
    // 移动端旧版工作台曾保存过不同的默认栏宽，仅在升级时迁移一次。
    const saved = isMobile && stored.shellVersion !== 2 ? {} : stored;
    const widths = {
      left: Number(saved.left) || leftPanel.getBoundingClientRect().width || 360,
      right: Number(saved.right) || rightPanel.getBoundingClientRect().width || 380
    };
    state.workspace = { stage, leftPanel, rightPanel, center, canvas, device, leftSplitter, rightSplitter, widths };
    stage.style.setProperty("--proto-editor-left-width", `${widths.left}px`);
    stage.style.setProperty("--proto-editor-right-width", `${widths.right}px`);
    stage.classList.toggle("proto-editor-left-collapsed", Boolean(saved.leftCollapsed));
    stage.classList.toggle("proto-editor-right-collapsed", Boolean(saved.rightCollapsed));
    if (isMobile && stored.shellVersion !== 2) saveWorkspaceLayout();
    bindWorkspaceSplitter(leftSplitter, "left");
    bindWorkspaceSplitter(rightSplitter, "right");
    if (window.ResizeObserver) new ResizeObserver(scheduleWorkspaceFit).observe(canvas);
    scheduleWorkspaceFit();
  }

  function injectRightPanel() {
    const panel = document.createElement("section");
    panel.className = "proto-editor-right-panel";
    panel.innerHTML = `
      <header class="proto-editor-right-header">
        <h2>标注编辑</h2>
        <span class="proto-editor-save-state" id="protoEditorSaveState" data-state="saved">已保存 0 项</span>
        <button class="proto-editor-icon-button" type="button" data-proto-editor-collapse="right" title="向右收起标注编辑" aria-label="向右收起标注编辑" aria-expanded="true">›</button>
      </header>
      <div class="proto-editor-note-tools">
        <div class="proto-editor-range-switch" id="protoEditorRangeSwitch" role="tablist" aria-label="标注页面范围">
          <button type="button" class="is-active" data-proto-editor-range="current" role="tab" aria-selected="true">当前页面 <span class="proto-editor-range-count">0</span></button>
          <button type="button" data-proto-editor-range="all" role="tab" aria-selected="false">全部页面 <span class="proto-editor-range-count">0</span></button>
        </div>
        <div class="proto-editor-note-tools-top">
          <span class="proto-editor-current-scope" id="protoEditorCurrentScope">当前页面</span>
          <button class="proto-editor-button primary" id="protoEditorAddNote" type="button">+ 新增标注</button>
        </div>
        <div class="proto-editor-filter" id="protoEditorFilter" aria-label="本轮修改图例">
          ${filterButton("all", "全部")}
          ${filterButton("original", "原有")}
          ${filterButton("added", "新增")}
          ${filterButton("modified", "已修改")}
          ${filterButton("deleted", "已删除")}
        </div>
      </div>
      <div class="proto-editor-note-list" id="protoEditorNoteList"></div>
    `;
    state.adapter.rightPanel.appendChild(panel);
    createPanelRail("right", "标注编辑");
    panel.querySelector('[data-proto-editor-collapse="right"]').addEventListener("click", () => setPanelCollapsed("right", true));
    panel.querySelector("#protoEditorRangeSwitch").addEventListener("click", event => {
      const button = event.target.closest("button[data-proto-editor-range]");
      if (!button) return;
      state.viewRange = button.dataset.protoEditorRange;
      panel.querySelectorAll("button[data-proto-editor-range]").forEach(node => {
        const active = node === button;
        node.classList.toggle("is-active", active);
        node.setAttribute("aria-selected", String(active));
      });
      renderNotes();
    });
    panel.querySelector('[data-proto-editor-filter="all"]').classList.add("is-active");
    panel.querySelector("#protoEditorFilter").addEventListener("click", event => {
      const button = event.target.closest("button[data-proto-editor-filter]");
      if (!button) return;
      state.filter = button.dataset.protoEditorFilter;
      panel.querySelectorAll("button[data-proto-editor-filter]").forEach(node => node.classList.toggle("is-active", node === button));
      renderNotes();
    });
    panel.querySelector("#protoEditorAddNote").addEventListener("click", startTargetSelection);
  }

  function filterButton(key, label) {
    return `<button type="button" data-proto-editor-filter="${key}"><span class="proto-editor-filter-dot"></span>${label}<span class="proto-editor-count">0</span></button>`;
  }

  function injectDocEditor() {
    const header = state.adapter.leftHeader;
    if (!header) return;
    header.querySelectorAll("#protoWebReviewCollapseLeft,#protoMobileCompactDocsClose").forEach(button => button.classList.add("proto-editor-host-control-hidden"));
    const title = header.querySelector(".protoWeb-review-side-title,strong") || document.createElement("span");
    title.classList.add("protoWeb-review-side-title");
    if (!title.isConnected) {
      title.textContent = "原型说明";
      header.prepend(title);
    }
    const actions = document.createElement("div");
    actions.className = "proto-editor-doc-header-actions";
    actions.innerHTML = `
      <button class="proto-editor-button proto-editor-doc-action-button" type="button" data-action="add-doc">新增栏目</button>
      <button class="proto-editor-button proto-editor-doc-action-button" type="button" data-action="delete-doc">删除栏目</button>
      <button class="proto-editor-button proto-editor-doc-edit-button" type="button" data-action="edit-doc">编辑</button>
      <button class="proto-editor-icon-button" type="button" data-proto-editor-collapse="left" title="向左收起原型说明" aria-label="向左收起原型说明" aria-expanded="true">‹</button>
    `;
    header.appendChild(actions);
    createPanelRail("left", "原型说明");
    actions.querySelector('[data-action="edit-doc"]').addEventListener("click", () => {
      if (state.editingDoc) cancelDocEdit();
      else beginDocEdit();
    });
    actions.querySelector('[data-action="add-doc"]').addEventListener("click", addDocSection);
    actions.querySelector('[data-action="delete-doc"]').addEventListener("click", deleteDocSection);
    actions.querySelector('[data-proto-editor-collapse="left"]').addEventListener("click", () => setPanelCollapsed("left", true));
    renderDocs();
  }

  function updateDocHeaderActions() {
    const hasSection = Boolean((state.session.workingGlobalSections || []).length);
    const editButton = state.adapter.leftHeader?.querySelector('[data-action="edit-doc"]');
    const deleteButton = state.adapter.leftHeader?.querySelector('[data-action="delete-doc"]');
    if (editButton) {
      editButton.disabled = !hasSection;
      editButton.textContent = state.editingDoc ? "取消" : "编辑";
    }
    if (deleteButton) deleteButton.disabled = !hasSection || state.editingDoc;
  }

  function addDocSection() {
    if (state.editingDoc) cancelDocEdit();
    const section = {
      id: createUniqueId("section", state.session.workingGlobalSections),
      title: "新建说明",
      content: "<p>填写该栏目的说明内容。</p>",
      format: "html"
    };
    state.session.workingGlobalSections.push(section);
    state.selectedDocId = section.id;
    state.editingDocNewId = section.id;
    renderDocs();
    beginDocEdit();
    requestAnimationFrame(() => {
      const input = state.adapter.docsBody.querySelector(".proto-editor-doc-editor-title");
      input?.focus();
      input?.select();
    });
  }

  function deleteDocSection() {
    if (state.editingDoc) return;
    const sections = state.session.workingGlobalSections || [];
    const index = sections.findIndex(section => section.id === state.selectedDocId);
    if (index < 0) return;
    sections.splice(index, 1);
    state.selectedDocId = sections[Math.min(index, sections.length - 1)]?.id || "";
    recomputeChanges();
    queueSave();
    renderDocs();
  }

  async function renderRich(container, content, format) {
    container.innerHTML = normalizeHtml(content, format);
    const mermaidNodes = Array.from(container.querySelectorAll("pre code.language-mermaid"));
    if (!mermaidNodes.length || !window.mermaid || typeof window.mermaid.run !== "function") return;
    mermaidNodes.forEach(code => {
      const block = document.createElement("div");
      block.className = "mermaid";
      block.textContent = code.textContent;
      code.closest("pre").replaceWith(block);
    });
    try {
      await window.mermaid.run({ nodes: Array.from(container.querySelectorAll(".mermaid")) });
    } catch (error) {
      console.warn("Mermaid 渲染失败", error);
    }
  }

  function docBodyHtml(content, format) {
    const template = document.createElement("template");
    template.innerHTML = normalizeHtml(content, format);
    const firstElement = template.content.firstElementChild;
    if (firstElement?.matches("h1")) firstElement.remove();
    return template.innerHTML.trim();
  }

  function renderDocs() {
    const sections = state.session.workingGlobalSections || [];
    updateDocHeaderActions();
    if (!sections.length) {
      state.adapter.docsNav.innerHTML = "";
      state.adapter.docsBody.innerHTML = '<div class="proto-editor-empty">当前原型没有全局说明</div>';
      return;
    }
    if (!sections.some(section => section.id === state.selectedDocId)) state.selectedDocId = sections[0].id;
    state.adapter.docsNav.innerHTML = sections.map(section => `
      <button type="button" data-doc-id="${escapeHtml(section.id)}" class="${section.id === state.selectedDocId ? "is-active" : ""}">${escapeHtml(section.title)}</button>
    `).join("");
    state.adapter.docsNav.onclick = event => {
      const button = event.target.closest("button[data-doc-id]");
      if (!button || state.editingDoc) return;
      state.selectedDocId = button.dataset.docId;
      renderDocs();
    };
    const section = sections.find(item => item.id === state.selectedDocId);
    if (!section) return;
    state.adapter.docsBody.classList.remove("proto-editor-doc-editing");
    state.adapter.docsBody.innerHTML = `<section class="proto-editor-rich-content"><h1 class="proto-editor-doc-view-title">${escapeHtml(section.title)}</h1><div data-doc-content></div></section>`;
    renderRich(state.adapter.docsBody.querySelector("[data-doc-content]"), docBodyHtml(section.content, section.format), "html");
  }

  function beginDocEdit() {
    const section = state.session.workingGlobalSections.find(item => item.id === state.selectedDocId);
    if (!section) return;
    const original = deepClone(section);
    state.editingDoc = true;
    state.adapter.leftPanel.classList.add("proto-editor-doc-editing");
    updateDocHeaderActions();
    const editor = createRichEditor(docBodyHtml(section.content, section.format), "html", "填写原型说明");
    const shell = document.createElement("div");
    shell.className = "proto-editor-doc-editor";
    shell.innerHTML = '<input class="proto-editor-doc-editor-title" maxlength="80"><div class="proto-editor-doc-editor-actions"><button class="proto-editor-button" type="button" data-action="cancel">取消</button><button class="proto-editor-button primary" type="button" data-action="save">保存说明</button></div>';
    shell.querySelector("input").value = section.title || "";
    const actions = shell.querySelector(".proto-editor-doc-editor-actions");
    shell.insertBefore(createToolbar(editor), actions);
    shell.insertBefore(editor, actions);
    state.adapter.docsBody.replaceChildren(shell);
    shell.querySelector('[data-action="cancel"]').addEventListener("click", cancelDocEdit);
    shell.querySelector('[data-action="save"]').addEventListener("click", () => saveDocEdit(section, original, shell, editor));
  }

  function cancelDocEdit() {
    if (state.editingDocNewId) {
      state.session.workingGlobalSections = state.session.workingGlobalSections.filter(section => section.id !== state.editingDocNewId);
      state.editingDocNewId = "";
    }
    state.editingDoc = false;
    state.adapter.leftPanel.classList.remove("proto-editor-doc-editing");
    renderDocs();
  }

  function saveDocEdit(section, original, shell, editor) {
    const title = shell.querySelector("input").value.trim();
    const content = sanitizeHtml(editor.innerHTML).trim();
    if (!title) return alert("请填写说明标题。");
    if (hasBrokenText(title) || hasBrokenText(content)) return alert("内容中存在乱码，请修正后再保存。");
    const contentChanged = content !== editor.dataset.initialHtml;
    if (title === String(original.title || "").trim() && !contentChanged) {
      cancelDocEdit();
      return;
    }
    section.title = title;
    section.content = content;
    section.format = "html";
    state.editingDocNewId = "";
    state.editingDoc = false;
    state.adapter.leftPanel.classList.remove("proto-editor-doc-editing");
    recomputeChanges();
    queueSave();
    renderDocs();
  }

  function injectOverlay() {
    const overlay = document.createElement("div");
    overlay.className = "proto-editor-overlay";
    overlay.id = "protoEditorOverlay";
    overlay.innerHTML = `
      <div class="proto-editor-marker-layer" id="protoEditorMarkerLayer"></div>
      <div class="proto-editor-dialog-backdrop" id="protoEditorDialogBackdrop"></div>
      <div class="proto-editor-select-tip" id="protoEditorSelectTip"><span>点击原型中的业务元素添加标注</span><button class="proto-editor-button" type="button">取消</button></div>
    `;
    const annotationRoot = state.platform === "mobile"
      ? document.getElementById("prototypeAnnotationRoot")
      : document.getElementById("prototypeAnnotationRoot");
    const host = annotationRoot || document.body;
    host.appendChild(overlay);
    overlay.dataset.layerHost = annotationRoot ? annotationRoot.id : "body";
    if (!annotationRoot) {
      overlay.setAttribute("popover", "manual");
      try { overlay.showPopover(); } catch (error) { overlay.style.zIndex = "2147483647"; }
    }
    overlay.querySelector("#protoEditorSelectTip button").addEventListener("click", stopTargetSelection);
  }

  function getContext() {
    return state.adapter.getContext();
  }

  function findNoteTarget(note, context = getContext()) {
    return annotationBoxTarget(state.adapter.findTarget(note, context));
  }

  function visibleScopeNotes() {
    const context = getContext();
    return state.session.workingAnnotations.filter(note => {
      if (!matchesScope(note.scope, context.scope)) return false;
      const target = findNoteTarget(note, context);
      return isRenderable(target);
    });
  }

  function selectedRangeNotes() {
    return state.viewRange === "all" ? state.session.workingAnnotations.slice() : visibleScopeNotes();
  }

  function localizedScopeName(name) {
    const words = String(name || "")
      .replace(/[_-]+/g, " ")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const dictionary = {
      add: "新增", create: "新增", confirm: "确认", dept: "部门", department: "部门",
      detail: "详情", dialog: "弹窗", drawer: "抽屉", edit: "编辑", filter: "筛选",
      handle: "办理", list: "列表", map: "地图", pending: "待处理", role: "角色",
      route: "路线", sheet: "面板", sort: "排序", submit: "提交", tag: "标签", task: "任务"
    };
    const localized = words.map(word => dictionary[word.toLowerCase()] || "").join("");
    return localized || "";
  }

  function scopeDisplayLabel(scope) {
    if (scope === state.scope) return state.scopeLabel || "当前页面";
    if (scope.startsWith("page:")) {
      const pageKey = scope.split(":")[1];
      if (state.platform === "web") {
        const page = document.getElementById(`page-${pageKey}`);
        return page?.dataset.title
          || page?.querySelector(".page-title,h1,h2")?.childNodes[0]?.textContent.trim()
          || pageKey;
      }
      const candidates = Array.from(state.adapter.businessRoot.querySelectorAll('[data-proto-scope^="page:"]'));
      const page = candidates.find(node => String(node.dataset.protoScope || "").split(":")[1] === pageKey);
      const pageTitle = page?.querySelector(".navbar-title,.nav-title,.page-title,h1,h2")?.textContent.trim() || pageKey;
      const tabKey = scope.split(":")[2];
      if (tabKey === "*") return `${pageTitle} · 公共`;
      if (tabKey) {
        const declaredTab = page?.querySelector(
          `[data-proto-tab="${escapeSelector(tabKey)}"],[data-scope-tab="${escapeSelector(tabKey)}"],[data-detail-tab="${escapeSelector(tabKey)}"],[data-tab="${escapeSelector(tabKey)}"]`
        );
        const tab = declaredTab || (page?.dataset.protoScope === scope
          ? page.querySelector('[role="tab"].is-active,.tabs-bar .tab-item.is-active,.tab-item.is-active')
          : null);
        const tabTitle = tab?.textContent.trim();
        if (tabTitle) return `${pageTitle} · ${tabTitle}`;
      }
      return pageTitle;
    }
    const [type, name] = String(scope || "其他").split(":");
    const scopeNode = Array.from(state.adapter.businessRoot.querySelectorAll("[data-proto-scope]"))
      .find(node => node.dataset.protoScope === scope);
    const title = scopeNode?.querySelector(".drawer-title,.sheet-title,.sheet-head b,.dialog-title,.modal-title,.panel-title,.navbar-title,.nav-title,.page-title,h1,h2")?.textContent.trim();
    if (title) return title;
    if (state.platform === "mobile") {
      const dialogCopy = scopeNode?.querySelector(".dialog-copy")?.textContent.trim();
      if (dialogCopy) return dialogCopy.split(/[？?。]/)[0].slice(0, 24);
    }
    const localizedName = localizedScopeName(name);
    if (localizedName) return localizedName;
    return type === "drawer" ? "抽屉" : type === "sheet" ? "底部面板" : type === "dialog" ? "弹窗" : "其他";
  }

  function updateContext() {
    if (!state.session || state.selectingTarget) return;
    const context = getContext();
    const changed = state.scope !== context.scope || state.scopeLabel !== context.label;
    state.scope = context.scope;
    state.scopeLabel = context.label;
    const workspaceScope = document.getElementById("protoEditorWorkspaceScope");
    if (workspaceScope) workspaceScope.textContent = context.label || "当前页面";
    if (changed) renderNotes();
    renderMarkers();
  }

  function runContextUpdate() {
    state.contextFrame = 0;
    updateContext();
    if (performance.now() < state.contextRefreshUntil) {
      state.contextFrame = requestAnimationFrame(runContextUpdate);
    }
  }

  function scheduleContextUpdate(settle = false) {
    if (settle === true) {
      state.contextRefreshUntil = Math.max(state.contextRefreshUntil, performance.now() + 900);
    }
    if (!state.contextFrame) state.contextFrame = requestAnimationFrame(runContextUpdate);
  }

  function noteState(note) {
    return note._editState || "original";
  }

  function renderNotes() {
    if (!state.session) return;
    const scopeNode = document.getElementById("protoEditorCurrentScope");
    if (scopeNode) scopeNode.textContent = state.scopeLabel || "当前页面";
    const currentNotes = visibleScopeNotes();
    const allNotes = state.session.workingAnnotations || [];
    document.querySelectorAll("[data-proto-editor-range]").forEach(button => {
      const count = button.dataset.protoEditorRange === "all" ? allNotes.length : currentNotes.length;
      button.querySelector(".proto-editor-range-count").textContent = String(count);
    });
    const all = selectedRangeNotes();
    const counts = { all: all.length, original: 0, added: 0, modified: 0, deleted: 0 };
    all.forEach(note => { counts[noteState(note)] = (counts[noteState(note)] || 0) + 1; });
    document.querySelectorAll("[data-proto-editor-filter]").forEach(button => {
      button.querySelector(".proto-editor-count").textContent = String(counts[button.dataset.protoEditorFilter] || 0);
    });
    const notes = all.filter(note => state.filter === "all" || noteState(note) === state.filter);
    const list = document.getElementById("protoEditorNoteList");
    if (!list) return;
    if (!notes.length) {
      list.innerHTML = '<div class="proto-editor-empty">当前范围没有符合条件的标注</div>';
      renderMarkers();
      return;
    }
    const renderCard = (note, index) => `
      <article class="proto-editor-note-card" data-note-id="${escapeHtml(note.id)}" data-state="${noteState(note)}">
        <span class="proto-editor-note-index">${index + 1}</span>
        <h3>${escapeHtml(note.title || "未命名标注")}</h3>
        <div class="proto-editor-note-summary">${escapeHtml(noteContentSummary(note) || "暂无标注内容")}</div>
        <div class="proto-editor-note-actions"><button class="proto-editor-button" type="button">编辑</button></div>
      </article>
    `;
    if (state.viewRange === "all") {
      const groups = new Map();
      notes.forEach(note => {
        const key = note.scope || "other:common";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(note);
      });
      let offset = 0;
      list.innerHTML = Array.from(groups.entries()).map(([scope, group]) => {
        const cards = group.map((note, index) => renderCard(note, offset + index)).join("");
        offset += group.length;
        return `<section class="proto-editor-note-group"><h3>${escapeHtml(scopeDisplayLabel(scope))}<span>${group.length} 条</span></h3>${cards}</section>`;
      }).join("");
    } else {
      list.innerHTML = notes.map(renderCard).join("");
    }
    list.querySelectorAll("[data-note-id]").forEach(card => {
      card.addEventListener("click", event => {
        const id = card.dataset.noteId;
        if (event.target.closest("button")) openNoteDialog(id);
        else locateNote(id);
      });
    });
    renderMarkers();
  }

  function markerPoint(note, target) {
    const rect = target.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, Number(note.x) || 0));
    const y = Math.max(0, Math.min(1, Number(note.y) || 0));
    return { left: rect.left + rect.width * x, top: rect.top + rect.height * y };
  }

  function markerDisplayBounds(target) {
    const container = target.closest(".protoMobile-device")
      || (state.platform === "web" ? document.getElementById("protoWebReviewPrototypeFrame") : null)
      || state.adapter.businessRoot;
    const rect = container?.getBoundingClientRect?.() || document.documentElement.getBoundingClientRect();
    return {
      left: Math.max(16, rect.left + 16),
      right: Math.min(window.innerWidth - 16, rect.right - 16),
      top: Math.max(16, rect.top + 16),
      bottom: Math.min(window.innerHeight - 16, rect.bottom - 16)
    };
  }

  function markerCandidates() {
    const candidates = [{ x: 0, y: 0 }];
    [36, 52, 68].forEach((radius, ring) => {
      const count = 8 + ring * 4;
      for (let index = 0; index < count; index += 1) {
        const angle = index * Math.PI * 2 / count;
        candidates.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
      }
    });
    return candidates;
  }

  function resolveMarkerDisplayPoints(entries) {
    const placed = [];
    const candidates = markerCandidates();
    return entries.map(entry => {
      const bounds = markerDisplayBounds(entry.target);
      let display = entry.point;
      for (const offset of candidates) {
        const candidate = { left: entry.point.left + offset.x, top: entry.point.top + offset.y };
        const inside = candidate.left >= bounds.left && candidate.left <= bounds.right
          && candidate.top >= bounds.top && candidate.top <= bounds.bottom;
        const clear = placed.every(point => Math.hypot(candidate.left - point.left, candidate.top - point.top) >= 34);
        if (inside && clear) {
          display = candidate;
          break;
        }
      }
      placed.push(display);
      return { ...entry, display };
    });
  }

  function renderMarkers() {
    const layer = document.getElementById("protoEditorMarkerLayer");
    if (!layer || !state.session) return;
    const notes = visibleScopeNotes();
    layer.replaceChildren();
    const entries = notes.map((note, index) => {
      const target = findNoteTarget(note);
      return target ? { note, index, target, point: markerPoint(note, target) } : null;
    }).filter(Boolean);
    resolveMarkerDisplayPoints(entries).forEach(({ note, index, target, point, display }) => {
      const marker = document.createElement("button");
      marker.type = "button";
      marker.className = "proto-editor-marker";
      marker.dataset.noteId = note.id;
      marker.dataset.state = noteState(note);
      marker.style.left = `${display.left - 15}px`;
      marker.style.top = `${display.top - 15}px`;
      marker.title = note.title || "编辑标注";
      const distance = Math.hypot(point.left - display.left, point.top - display.top);
      if (distance > 2) {
        const leader = document.createElement("span");
        leader.className = "proto-editor-marker-leader";
        leader.style.width = `${distance}px`;
        leader.style.transform = `rotate(${Math.atan2(point.top - display.top, point.left - display.left)}rad)`;
        marker.appendChild(leader);
        marker.dataset.displaced = "true";
      }
      const label = document.createElement("span");
      label.className = "proto-editor-marker-label";
      label.textContent = String(index + 1);
      marker.appendChild(label);
      marker.addEventListener("click", event => {
        if (marker.dataset.dragged === "true") {
          marker.dataset.dragged = "false";
          return;
        }
        event.stopPropagation();
        openNoteDialog(note.id);
      });
      marker.addEventListener("pointerdown", event => startMarkerDrag(event, marker, note, target));
      layer.appendChild(marker);
    });
  }

  function startMarkerDrag(event, marker, note, target) {
    event.preventDefault();
    event.stopPropagation();
    try { marker.setPointerCapture(event.pointerId); } catch (error) { /* 使用全局监听兜底。 */ }
    const start = { x: event.clientX, y: event.clientY, noteX: Number(note.x) || 0, noteY: Number(note.y) || 0 };
    state.draggingMarker = { marker, note, target, start, moved: false };
    const move = moveEvent => {
      if (moveEvent.pointerId !== event.pointerId) return;
      const rect = target.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dx = moveEvent.clientX - start.x;
      const dy = moveEvent.clientY - start.y;
      if (!state.draggingMarker.moved && Math.hypot(dx, dy) <= 8) return;
      state.draggingMarker.moved = true;
      note.x = Math.max(0, Math.min(1, (moveEvent.clientX - rect.left) / rect.width));
      note.y = Math.max(0, Math.min(1, (moveEvent.clientY - rect.top) / rect.height));
      const point = markerPoint(note, target);
      marker.style.left = `${point.left - 15}px`;
      marker.style.top = `${point.top - 15}px`;
      marker.querySelector(".proto-editor-marker-leader")?.remove();
      marker.dataset.displaced = "false";
    };
    const end = endEvent => {
      if (endEvent.pointerId !== event.pointerId) return;
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", end, true);
      try { marker.releasePointerCapture(event.pointerId); } catch (error) { /* 指针可能已自动释放。 */ }
      marker.dataset.dragged = String(Boolean(state.draggingMarker && state.draggingMarker.moved));
      if (state.draggingMarker && state.draggingMarker.moved) {
        recomputeChanges();
        queueSave();
        renderNotes();
      } else {
        note.x = start.noteX;
        note.y = start.noteY;
      }
      state.draggingMarker = null;
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
  }

  function pageKeyFromScope(scope) {
    return String(scope || "").startsWith("page:") ? String(scope).split(":")[1] : "";
  }

  function invokeKnownPageNavigator(pageKey, pageNode) {
    const candidates = state.platform === "mobile"
      ? [pageNode?.id, pageKey, pageKey && `${pageKey}Page`]
      : [pageKey, pageNode?.id, pageKey && `page-${pageKey}`];
    const names = state.platform === "mobile"
      ? ["showPage", "navigate", "switchPage", "openPage"]
      : ["navigate", "showPage", "switchPage", "openPage"];
    for (const name of names) {
      const handler = window[name];
      if (typeof handler !== "function") continue;
      const key = candidates.find(Boolean);
      if (!key) continue;
      try {
        handler(key);
        return true;
      } catch (error) {
        // 兼容旧原型的全局导航函数，失败后继续使用 DOM 路由。
      }
    }
    return false;
  }

  function activateMobilePage(page) {
    if (!page || state.platform !== "mobile") return;
    const pageContainer = page.closest(".app-page,.page,[data-proto-page]") || page;
    const pageKey = pageKeyFromScope(page.dataset.protoScope || pageContainer.dataset.protoScope);
    if (invokeKnownPageNavigator(pageKey, pageContainer)) {
      document.dispatchEvent(new Event("prototype-annotation:scopechange"));
      return;
    }
    const pages = Array.from(state.adapter.businessRoot.querySelectorAll(".app-page,.page,[data-proto-page]"))
      .filter(node => !node.parentElement?.closest(".app-page,.page,[data-proto-page]"));
    const usesActive = pages.some(node => node.classList.contains("active"));
    const usesHidden = pages.some(node => node.hasAttribute("hidden"));
    pages.forEach(node => {
      node.classList.toggle("is-active", node === pageContainer);
      if (usesActive) node.classList.toggle("active", node === pageContainer);
      if (usesHidden) node.hidden = node !== pageContainer;
    });
    document.dispatchEvent(new Event("prototype-annotation:scopechange"));
  }

  function findMobileScopeRoute(scope) {
    const direct = safeQuery(state.adapter.businessRoot,
      `[data-proto-route="${escapeSelector(scope)}"]`);
    if (direct || state.platform !== "mobile") return direct;
    if (String(scope).startsWith("page:")) {
      const pageKey = pageKeyFromScope(scope);
      const pageRoute = safeQuery(state.adapter.businessRoot,
        `[data-proto-route="page:${escapeSelector(pageKey)}"],[data-page="${escapeSelector(pageKey)}"],[data-page-link="${escapeSelector(pageKey)}"],[data-proto-page="${escapeSelector(pageKey)}"]`);
      if (pageRoute) return pageRoute;
    }
    const scopeNode = safeQuery(state.adapter.businessRoot,
      `[data-proto-scope="${escapeSelector(scope)}"]`);
    const scopeId = scopeNode?.id || "";
    const routeKey = String(scope).split(":").slice(1).join("-");
    const camelKey = routeKey.replace(/-([a-z0-9])/g, (_, character) => character.toUpperCase());
    const capitalized = camelKey ? camelKey[0].toUpperCase() + camelKey.slice(1) : "";
    const selectors = [
      scopeId && `[aria-controls="${escapeSelector(scopeId)}"]`,
      scopeId && `[data-target="#${escapeSelector(scopeId)}"]`,
      scopeId && `[data-target="${escapeSelector(scopeId)}"]`,
      scopeId && `[data-modal="${escapeSelector(scopeId)}"]`,
      scopeId && `[data-drawer="${escapeSelector(scopeId)}"]`,
      scopeId && `[data-sheet="${escapeSelector(scopeId)}"]`,
      camelKey && `#${escapeSelector(camelKey)}Btn`,
      capitalized && `#open${escapeSelector(capitalized)}Btn`,
      capitalized && `#show${escapeSelector(capitalized)}Btn`
    ].filter(Boolean);
    for (const selector of selectors) {
      const trigger = safeQuery(state.adapter.businessRoot, selector);
      if (trigger && !scopeNode?.contains(trigger)) return trigger;
    }
    return null;
  }

  function findWebScopeRoute(scope) {
    const direct = safeQuery(state.adapter.businessRoot,
      `[data-proto-route="${escapeSelector(scope)}"]`);
    if (direct || !String(scope).startsWith("page:")) return direct;
    const pageKey = pageKeyFromScope(scope);
    const pageNode = webScopeNode(scope);
    const selectors = [
      `[data-proto-route="page:${escapeSelector(pageKey)}"]`,
      `[data-page-link="${escapeSelector(pageKey)}"]`,
      `[data-page="${escapeSelector(pageKey)}"]`,
      `[data-proto-page="${escapeSelector(pageKey)}"]`,
      `[data-route="${escapeSelector(pageKey)}"]`,
      pageNode?.id && `[aria-controls="${escapeSelector(pageNode.id)}"]`,
      pageNode?.id && `[href="#${escapeSelector(pageNode.id)}"]`
    ].filter(Boolean);
    for (const selector of selectors) {
      const trigger = safeQuery(state.adapter.businessRoot, selector);
      if (trigger) return trigger;
    }
    return Array.from(state.adapter.businessRoot.querySelectorAll("[onclick]")).find(node => {
      const source = String(node.getAttribute("onclick") || "");
      return source.includes(`navigate('${pageKey}')`)
        || source.includes(`navigate(\"${pageKey}\")`)
        || source.includes(`showPage('${pageKey}')`)
        || source.includes(`showPage(\"${pageKey}\")`);
    }) || null;
  }

  function activateNoteScope(note) {
    if (matchesScope(note.scope, getContext().scope)) return;
    const scopeRoute = state.platform === "mobile"
      ? findMobileScopeRoute(note.scope)
      : findWebScopeRoute(note.scope);
    if (scopeRoute) {
      if (state.platform === "mobile") {
        const ownerPage = scopeRoute.closest(".app-page,.page,[data-proto-scope^='page:']");
        if (ownerPage) activateMobilePage(ownerPage);
      }
      scopeRoute.click();
      if (matchesScope(note.scope, getContext().scope)) {
        document.dispatchEvent(new Event("prototype-annotation:scopechange"));
        return;
      }
    }
    if (state.platform === "web" && note.scope.startsWith("page:")) {
      const pageKey = pageKeyFromScope(note.scope);
      const pageNode = webScopeNode(note.scope);
      const trigger = findWebScopeRoute(note.scope);
      if (trigger) trigger.click();
      else invokeKnownPageNavigator(pageKey, pageNode);
      document.dispatchEvent(new Event("prototype-annotation:scopechange"));
      return;
    }
    if (state.platform === "mobile" && note.scope.startsWith("page:")) {
      const scopeNode = mobileScopeNode(state.adapter.businessRoot, note.scope);
      const target = safeQuery(scopeNode || state.adapter.businessRoot, note.target);
      const page = scopeNode?.closest(".app-page,.page")
        || (scopeNode?.matches(".app-page,.page") ? scopeNode : null)
        || target?.closest(".app-page,.page,[data-proto-scope^='page:']")
        || scopeNode;
      if (page) {
        activateMobilePage(page);
        const tabKey = note.scope.split(":")[2];
        if (tabKey && page.dataset.protoScope !== note.scope) {
          const exactTab = page.querySelector(`[data-proto-tab="${escapeSelector(tabKey)}"],[data-scope-tab="${escapeSelector(tabKey)}"],[data-detail-tab="${escapeSelector(tabKey)}"],[data-tab="${escapeSelector(tabKey)}"]`);
          if (exactTab) exactTab.click();
          if (page.dataset.protoScope !== note.scope) {
            const candidates = Array.from(page.querySelectorAll('[role="tab"],.tabs-bar .tab-item'));
            candidates.some(candidate => {
              candidate.click();
              return page.dataset.protoScope === note.scope;
            });
          }
        }
        document.dispatchEvent(new Event("prototype-annotation:scopechange"));
      }
    }
  }

  function locateNote(id) {
    const note = state.session.workingAnnotations.find(item => item.id === id);
    if (!note) return;
    activateNoteScope(note);
    const delays = [0, 80, 220, 500, 900];
    const tryLocate = index => {
      if (locateActiveNote(note) || index >= delays.length - 1) return;
      window.setTimeout(() => tryLocate(index + 1), delays[index + 1] - delays[index]);
    };
    window.setTimeout(() => tryLocate(0), delays[0]);
  }

  function locateActiveNote(note) {
    updateContext();
    const target = findNoteTarget(note) || safeQuery(state.adapter.businessRoot, note.target);
    if (!target || !isRenderable(target)) return false;
    const device = target.closest(".protoMobile-device");
    const scrollContainer = target.closest("[data-proto-scroll-container],.main-scroller,.content,.drawer-body");
    const targetRect = target.getBoundingClientRect();
    const viewportRect = (scrollContainer || device || document.documentElement).getBoundingClientRect();
    const fullyVisible = targetRect.top >= viewportRect.top && targetRect.bottom <= viewportRect.bottom;
    if (!fullyVisible && scrollContainer && scrollContainer !== device) {
      const nextTop = Math.max(0, Math.min(scrollContainer.scrollHeight - scrollContainer.clientHeight,
        scrollContainer.scrollTop + targetRect.top - viewportRect.top - Math.max(20, (viewportRect.height - targetRect.height) / 2)));
      scrollContainer.scrollTo({ top: nextTop, behavior: "smooth" });
    }
    target.classList.add("proto-editor-target-highlight");
    setTimeout(() => target.classList.remove("proto-editor-target-highlight"), 1200);
    scheduleContextUpdate();
    return true;
  }

  function buildNoteDialog(note, isNew) {
    const original = deepClone(note);
    const backdrop = document.getElementById("protoEditorDialogBackdrop");
    backdrop.innerHTML = `
      <section class="proto-editor-dialog" role="dialog" aria-modal="true" aria-label="${isNew ? "新增标注" : "编辑标注"}">
        <header class="proto-editor-dialog-header"><strong>${isNew ? "新增标注" : "编辑标注"}</strong><button class="proto-editor-icon-button" type="button" data-action="close" aria-label="关闭">${icons.close}</button></header>
        <div class="proto-editor-dialog-body">
          <label>标注标题<input class="proto-editor-title-input" maxlength="80" value="${escapeHtml(note.title || "")}" placeholder="说明功能点或业务规则"></label>
          <div class="proto-editor-editor-field"><label>标注内容</label><div data-editor-host></div></div>
        </div>
        <footer class="proto-editor-dialog-footer">
          <button class="proto-editor-button danger" type="button" data-action="delete">${noteState(note) === "deleted" ? "恢复标注" : "删除标注"}</button>
          <span class="proto-editor-dialog-footer-end"><button class="proto-editor-ai-toggle proto-editor-ai-toggle-footer" type="button" role="switch" aria-checked="false">AI 润色</button><button class="proto-editor-button" type="button" data-action="cancel">取消</button><button class="proto-editor-button primary" type="button" data-action="save">保存标注</button></span>
        </footer>
      </section>
    `;
    const editor = createRichEditor(note.content, note.format, "填写功能规则、权限、数据口径或异常处理等内容");
    const toolbar = createToolbar(editor);
    const aiToggle = backdrop.querySelector(".proto-editor-ai-toggle-footer");
    aiToggle.setAttribute("aria-checked", String(note._contentPolicy === "ai-polish"));
    aiToggle.addEventListener("click", () => {
      const next = aiToggle.getAttribute("aria-checked") !== "true";
      aiToggle.setAttribute("aria-checked", String(next));
    });
    const host = backdrop.querySelector("[data-editor-host]");
    host.append(toolbar, editor);
    backdrop.classList.add("is-open");
    backdrop.querySelector('[data-action="close"]').addEventListener("click", closeNoteDialog);
    backdrop.querySelector('[data-action="cancel"]').addEventListener("click", closeNoteDialog);
    backdrop.querySelector('[data-action="save"]').addEventListener("click", () => saveNoteDialog(note, original, isNew, backdrop, editor, aiToggle));
    backdrop.querySelector('[data-action="delete"]').addEventListener("click", () => toggleDeleteNote(note, isNew));
    setTimeout(() => backdrop.querySelector(".proto-editor-title-input").focus(), 0);
  }

  function openNoteDialog(id) {
    const note = state.session.workingAnnotations.find(item => item.id === id);
    if (!note) return;
    state.editingNoteId = id;
    state.editingNewNote = null;
    buildNoteDialog(note, false);
  }

  function closeNoteDialog() {
    const backdrop = document.getElementById("protoEditorDialogBackdrop");
    if (backdrop) {
      backdrop.classList.remove("is-open");
      backdrop.replaceChildren();
    }
    state.editingNoteId = "";
    state.editingNewNote = null;
  }

  function saveNoteDialog(note, original, isNew, backdrop, editor, aiToggle) {
    const title = backdrop.querySelector(".proto-editor-title-input").value.trim();
    const content = sanitizeHtml(editor.innerHTML).trim();
    const contentPolicy = aiToggle.getAttribute("aria-checked") === "true" ? "ai-polish" : "direct";
    if (!title) return alert("请填写标注标题。");
    if (!content) return alert("请填写标注内容。");
    if (hasBrokenText(title) || hasBrokenText(content)) return alert("内容中存在乱码，请修正后再保存。");
    const contentChanged = content !== editor.dataset.initialHtml;
    if (!isNew
      && title === String(original.title || "").trim()
      && !contentChanged
      && contentPolicy === (original._contentPolicy || "direct")) {
      closeNoteDialog();
      return;
    }
    note.title = title;
    note.content = contentChanged ? content : original.content;
    note.format = contentChanged ? "html" : original.format;
    note._contentPolicy = contentPolicy;
    if (isNew) state.session.workingAnnotations.push(note);
    recomputeChanges();
    queueSave();
    closeNoteDialog();
    renderNotes();
  }

  function toggleDeleteNote(note, isNew) {
    if (isNew || noteState(note) === "added") {
      state.session.workingAnnotations = state.session.workingAnnotations.filter(item => item.id !== note.id);
    } else if (noteState(note) === "deleted") {
      note._editState = "original";
    } else {
      note._editState = "deleted";
    }
    recomputeChanges();
    queueSave();
    closeNoteDialog();
    renderNotes();
  }

  function startTargetSelection() {
    if (state.selectingTarget) return;
    state.selectionContext = getContext();
    state.selectingTarget = true;
    document.body.classList.add("proto-editor-selecting");
    document.getElementById("protoEditorSelectTip").classList.add("is-open");
  }

  function stopTargetSelection() {
    state.selectingTarget = false;
    document.body.classList.remove("proto-editor-selecting");
    document.getElementById("protoEditorSelectTip")?.classList.remove("is-open");
    if (state.hoverTarget) state.hoverTarget.classList.remove("proto-editor-target-hover");
    state.hoverTarget = null;
    state.selectionContext = null;
  }

  function isEditorNode(node) {
    return Boolean(node && (node.closest(".proto-editor-overlay,.proto-editor-right-panel,.protoWeb-review-left,.protoMobile-docs-panel,.protoMobile-notes-panel")));
  }

  function qualifySelector(selector, node, root) {
    const rootSelector = root?.id
      ? `#${escapeSelector(root.id)}`
      : root?.hasAttribute?.("data-proto-scope")
        ? `[data-proto-scope="${String(root.dataset.protoScope).replace(/"/g, '\\"')}"]`
        : "";
    if (rootSelector) {
      if (node === root) return rootSelector;
      const anchored = `${rootSelector} ${selector}`;
      if (safeQueryUnique(document, anchored) === node) return anchored;
    }
    return safeQueryUnique(document, selector) === node ? selector : "";
  }

  function createSelector(node, context = getContext()) {
    if (node.id) return `#${escapeSelector(node.id)}`;
    const root = context.scopeNode || state.adapter.businessRoot;
    const rootSelector = qualifySelector("", root, root);
    if (node === root && rootSelector) return rootSelector;
    const stableAttributes = ["data-proto-scroll-container", "data-page-link", "data-drawer", "data-tab", "name"];
    for (const name of stableAttributes) {
      if (!node.hasAttribute(name)) continue;
      const value = node.getAttribute(name);
      const selector = !value ? `[${name}]` : `[${name}="${String(value).replace(/"/g, '\\"')}"]`;
      const qualified = qualifySelector(selector, node, root);
      if (qualified) return qualified;
    }
    const parts = [];
    let current = node;
    while (current && current !== root && current !== state.adapter.businessRoot && current !== document.body && parts.length < 7) {
      let part = current.tagName.toLowerCase();
      const usefulClass = Array.from(current.classList).find(name => !/^(active|open|selected|is-|role-)/.test(name));
      if (usefulClass) {
        part += `.${escapeSelector(usefulClass)}`;
        if (current.parentElement) {
          const sameClass = Array.from(current.parentElement.children).filter(item => item.tagName === current.tagName && item.classList.contains(usefulClass));
          if (sameClass.length > 1) {
            const sameTag = Array.from(current.parentElement.children).filter(item => item.tagName === current.tagName);
            part += `:nth-of-type(${sameTag.indexOf(current) + 1})`;
          }
        }
      } else if (current.parentElement) {
        const siblings = Array.from(current.parentElement.children).filter(item => item.tagName === current.tagName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
      parts.unshift(part);
      const selector = parts.join(" > ");
      const qualified = qualifySelector(selector, node, root);
      if (qualified) return qualified;
      current = current.parentElement;
    }
    const selector = parts.join(" > ");
    return qualifySelector(selector, node, root) || selector;
  }

  function createNewNote(target, pointer, context = getContext()) {
    const rect = target.getBoundingClientRect();
    const label = target.getAttribute("aria-label") || target.textContent.trim().replace(/\s+/g, " ").slice(0, 24);
    return {
      id: createUniqueId("note", state.session.workingAnnotations),
      scope: context.scope,
      target: createSelector(target, context),
      x: Math.max(0, Math.min(1, ((pointer?.clientX ?? rect.left + rect.width / 2) - rect.left) / rect.width)) || 0.5,
      y: Math.max(0, Math.min(1, ((pointer?.clientY ?? rect.top + rect.height / 2) - rect.top) / rect.height)) || 0.5,
      title: label ? `${label}业务说明` : "新增业务说明",
      content: "<p>请补充该功能点的业务规则、数据口径、角色权限或异常处理逻辑。</p>",
      format: "html",
      _editState: "added",
      _contentPolicy: "direct"
    };
  }

  function recomputeChanges() {
    const baseNotes = new Map((state.session.baseAnnotations || []).map(note => [note.id, note]));
    const workingNotes = new Map((state.session.workingAnnotations || []).map(note => [note.id, note]));
    const operations = [];

    state.session.workingAnnotations.forEach(note => {
      const base = baseNotes.get(note.id);
      if (!base) {
        note._editState = "added";
        if (note._editState !== "deleted") operations.push({ entityType: "annotation", action: "add", id: note.id, value: cleanEntity(note), contentPolicy: note._contentPolicy || "direct" });
        return;
      }
      if (note._editState === "deleted") {
        operations.push({ entityType: "annotation", action: "delete", id: note.id });
        return;
      }
      const changed = comparable(note) !== comparable(base) || (note._contentPolicy || "direct") !== "direct";
      note._editState = changed ? "modified" : "original";
      if (changed) operations.push({ entityType: "annotation", action: "update", id: note.id, value: cleanEntity(note), contentPolicy: note._contentPolicy || "direct" });
    });
    baseNotes.forEach((base, id) => {
      if (!workingNotes.has(id)) operations.push({ entityType: "annotation", action: "delete", id });
    });

    const baseDocs = new Map((state.session.baseGlobalSections || []).map(section => [section.id, section]));
    const workingDocs = new Map((state.session.workingGlobalSections || []).map(section => [section.id, section]));
    state.session.workingGlobalSections.forEach(section => {
      const base = baseDocs.get(section.id);
      if (!base) {
        section._editState = "added";
        operations.push({ entityType: "global-section", action: "add", id: section.id, value: cleanEntity(section) });
      } else if (comparable(section) !== comparable(base)) {
        section._editState = "modified";
        operations.push({ entityType: "global-section", action: "update", id: section.id, value: cleanEntity(section) });
      } else {
        section._editState = "original";
      }
    });
    baseDocs.forEach((base, id) => {
      if (!workingDocs.has(id)) operations.push({ entityType: "global-section", action: "delete", id });
    });
    state.session.operations = operations;
    updateSaveState("saved");
  }

  function uniqueChangeCount() {
    return new Set((state.session.operations || []).map(operation => `${operation.entityType}:${operation.id}`)).size;
  }

  function updateSaveState(status, message) {
    const node = document.getElementById("protoEditorSaveState");
    if (!node || !state.session) return;
    node.dataset.state = status;
    node.textContent = message || `${status === "saving" ? "正在保存" : status === "error" ? "保存失败" : "已保存"} ${uniqueChangeCount()} 项`;
  }

  function queueSave() {
    clearTimeout(state.saveTimer);
    updateSaveState("saving");
    state.saveTimer = window.setTimeout(saveSession, 220);
  }

  async function saveSession() {
    try {
      const result = await api("/session", { method: "PUT", body: JSON.stringify(state.session) });
      state.session.updatedAt = result.updatedAt;
      state.lastSessionUpdate = result.updatedAt;
      updateSaveState("saved");
    } catch (error) {
      if (error.status === 409) return;
      console.error("保存标注编辑会话失败", error);
      updateSaveState("error");
    }
  }

  function bindGlobalEvents() {
    document.addEventListener("pointerover", event => {
      if (!state.selectingTarget || isEditorNode(event.target)) return;
      const semanticTarget = event.target.closest("button,a,input,select,textarea,[role=button],.metric-card,.dash-block,.panel,.form-item,.condition-item,.table-wrap,.card,.list-item") || event.target;
      const target = annotationBoxTarget(semanticTarget);
      if (!target) return;
      if (!state.adapter.businessRoot.contains(target)) return;
      if (state.hoverTarget && state.hoverTarget !== target) state.hoverTarget.classList.remove("proto-editor-target-hover");
      state.hoverTarget = target;
      target.classList.add("proto-editor-target-hover");
    }, true);
    document.addEventListener("click", event => {
      if (state.platform === "web") rememberWebOverlayScope(event.target);
      if (!state.selectingTarget) {
        scheduleContextUpdate();
        return;
      }
      if (isEditorNode(event.target)) return;
      const rawTarget = event.target;
      const semanticTarget = rawTarget.closest("button,a,input,select,textarea,[role=button],.metric-card,.dash-block,.panel,.form-item,.condition-item,.table-wrap,.card,.list-item") || rawTarget;
      const target = annotationBoxTarget(semanticTarget);
      if (!target) return;
      if (!state.adapter.businessRoot.contains(target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      target.classList.remove("proto-editor-target-hover");
      const selectionContext = state.selectionContext || getContext();
      const note = createNewNote(target, event, selectionContext);
      stopTargetSelection();
      state.editingNewNote = note;
      buildNoteDialog(note, true);
    }, true);
    document.addEventListener("prototype-annotation:scopechange", () => scheduleContextUpdate(true));
    // 弹窗、抽屉在进入动画期间位置持续变化，需要持续重算到布局稳定。
    document.addEventListener("animationstart", () => scheduleContextUpdate(true), true);
    document.addEventListener("animationend", () => scheduleContextUpdate(true), true);
    document.addEventListener("animationcancel", () => scheduleContextUpdate(true), true);
    document.addEventListener("transitionrun", () => scheduleContextUpdate(true), true);
    document.addEventListener("transitionend", () => scheduleContextUpdate(true), true);
    document.addEventListener("transitioncancel", () => scheduleContextUpdate(true), true);
    window.addEventListener("resize", () => {
      scheduleWorkspaceFit();
      scheduleContextUpdate(true);
    });
    window.addEventListener("scroll", () => scheduleContextUpdate(), true);
    const observer = new MutationObserver(() => scheduleContextUpdate(true));
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class", "hidden", "style", "aria-hidden", "data-proto-scope", "data-proto-layer"] });
    if (window.ResizeObserver) {
      const resizeObserver = new ResizeObserver(() => scheduleContextUpdate(true));
      resizeObserver.observe(state.adapter.businessRoot);
      if (state.adapter.stage && state.adapter.stage !== state.adapter.businessRoot) resizeObserver.observe(state.adapter.stage);
    }
  }

  function pollForAppliedVersion() {
    setInterval(async () => {
      if (!state.session) return;
      try {
        const result = await api("/status");
        if (result.sessionId !== state.session.sessionId) {
          location.replace(config.stableUrl);
          return;
        }
        if (result.updatedAt && result.updatedAt !== state.lastSessionUpdate && result.updatedAt !== state.session.updatedAt) {
          location.reload();
        }
      } catch (error) {
        if (error.status !== 409) console.warn("检查原型更新失败", error);
      }
    }, 1200);
  }

  async function initialize() {
    document.documentElement.dataset.protoEditorRuntimeStatus = "initializing";
    try {
      state.session = await api("/session");
      state.lastSessionUpdate = state.session.updatedAt;
      await ensureWebReviewMode();
      state.adapter = createAdapter();
      if (!state.adapter.leftPanel || !state.adapter.rightPanel || !state.adapter.docsNav || !state.adapter.docsBody) {
        throw new Error("当前原型缺少三栏审阅结构，无法进入标注编辑模式。");
      }
      document.body.classList.add("proto-editor-edit-mode");
      installSharedWorkspace();
      injectRightPanel();
      injectDocEditor();
      injectOverlay();
      recomputeChanges();
      bindGlobalEvents();
      window.__protoEditorEditor = {
        inspect() {
          return {
            platform: state.platform,
            sessionId: state.session.sessionId,
            scope: state.scope,
            visibleNoteIds: visibleScopeNotes().map(note => note.id),
            operationCount: state.session.operations.length,
            uniqueChangeCount: uniqueChangeCount()
          };
        },
        save: saveSession,
        refresh: updateContext
      };
      updateContext();
      pollForAppliedVersion();
      document.documentElement.dataset.protoEditorRuntimeStatus = "ready";
      document.documentElement.removeAttribute("data-proto-editor-runtime-error");
    } catch (error) {
      document.documentElement.dataset.protoEditorRuntimeStatus = "error";
      document.documentElement.dataset.protoEditorRuntimeError = String(error && error.message || error);
      console.error("标注编辑器初始化失败", error);
      alert(`标注编辑器初始化失败：${error.message}`);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(initialize, 0), { once: true });
  else setTimeout(initialize, 0);
}());
