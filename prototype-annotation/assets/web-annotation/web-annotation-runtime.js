(() => {
  const dataNode = document.getElementById("prototypeAnnotationData");
  const root = document.getElementById("prototypeAnnotationRoot");
  const markerLayer = document.getElementById("protoWebMarkerLayer");
  const launcher = document.getElementById("protoWebLauncher");
  const launcherCount = document.getElementById("protoWebLauncherCount");
  const menu = document.getElementById("protoWebMenu");
  const menuCount = document.getElementById("protoWebMenuCount");
  const pageToggle = document.getElementById("protoWebPageToggle");
  const openDocsButton = document.getElementById("protoWebOpenDocs");
  const panel = document.getElementById("protoWebPanel");
  const panelHeader = document.getElementById("protoWebPanelHeader");
  const panelHeading = document.getElementById("protoWebPanelHeading");
  const content = document.getElementById("protoWebContent");
  const pageCount = document.getElementById("protoWebPageCount");
  const prevButton = document.getElementById("protoWebPrev");
  const nextButton = document.getElementById("protoWebNext");
  const collapseButton = document.getElementById("protoWebCollapse");
  const closeButton = document.getElementById("protoWebClose");
  const docsBackdrop = document.getElementById("protoWebDocsBackdrop");
  const docsNav = document.getElementById("protoWebDocsNav");
  const docsBody = document.getElementById("protoWebDocsBody");
  const docsContent = document.getElementById("protoWebDocsContent");
  const docsMeta = document.getElementById("protoWebDocsMeta");
  const docsCloseButton = document.getElementById("protoWebDocsClose");
  const menuFloatModeButton = document.getElementById("protoWebMenuModeFloat");
  const openReviewButton = document.getElementById("protoWebOpenReview");
  const reviewWorkspace = document.getElementById("protoWebReviewWorkspace");
  const reviewCanvas = document.getElementById("protoWebReviewCanvas");
  const reviewPrototypeFrame = document.getElementById("protoWebReviewPrototypeFrame");
  const reviewLeftSplitter = document.getElementById("protoWebReviewSplitterLeft");
  const reviewRightSplitter = document.getElementById("protoWebReviewSplitterRight");
  const reviewFloatModeButton = document.getElementById("protoWebReviewModeFloat");
  const reviewColumnsModeButton = document.getElementById("protoWebReviewModeColumns");
  const reviewCollapseLeftButton = document.getElementById("protoWebReviewCollapseLeft");
  const reviewExpandLeftButton = document.getElementById("protoWebReviewExpandLeft");
  const reviewCollapseRightButton = document.getElementById("protoWebReviewCollapseRight");
  const reviewExpandRightButton = document.getElementById("protoWebReviewExpandRight");
  const reviewDocsNav = document.getElementById("protoWebReviewDocsNav");
  const reviewDocsBody = document.getElementById("protoWebReviewDocsBody");
  const reviewNoteList = document.getElementById("protoWebReviewNoteList");
  const reviewNoteCount = document.getElementById("protoWebReviewNoteCount");
  const reviewNoteToggle = document.getElementById("protoWebReviewNoteToggle");
  const reviewScopeLabel = document.getElementById("protoWebReviewScope");

  if (!dataNode || !root) return;

  let annotationData;
  try {
    annotationData = JSON.parse(dataNode.textContent);
  } catch (error) {
    console.error("原型标注数据解析失败", error);
    root.hidden = true;
    return;
  }

  const annotations = Array.isArray(annotationData.annotations) ? annotationData.annotations : [];
  const globalSections = Array.isArray(annotationData.globalSections) ? annotationData.globalSections : [];
  const storageKey = `protoWeb-ui:${annotationData.prototypeId || "prototype"}`;
  const reviewStorageKey = `protoWeb-review:${annotationData.prototypeId || "prototype"}`;
  const reviewOptions = annotationData.review && typeof annotationData.review === "object" ? annotationData.review : {};
  const reviewDesignWidth = Number(reviewOptions.designWidth) > 0 ? Number(reviewOptions.designWidth) : 1920;
  const reviewDesignHeight = Number(reviewOptions.designHeight) > 0 ? Number(reviewOptions.designHeight) : 1080;
  const reviewCanvasMargin = 16;
  const reviewPlacementAnchors = new Map();
  let enabled = false;
  let currentNoteId = "";
  let currentPanelNotes = [];
  let currentPanelScope = "";
  let panelScopeMismatchSince = 0;
  let currentGlobalSectionId = globalSections[0]?.id || "";
  let layoutFrame = 0;
  let contextRefreshFrame = 0;
  let contextRefreshUntil = 0;
  let saveTimer = 0;
  let mermaidRenderCounter = 0;
  let restoredPanelSize = { width: 440, height: 460 };
  let annotationAuditTimer = 0;
  let reviewLayoutFrame = 0;
  let reviewSyncFrame = 0;
  let reviewRenderVersion = 0;
  let reviewActiveNoteId = "";
  let reviewContextSignature = "";
  let reviewPendingSignature = "";
  let launcherPlacementBeforeReview = null;
  let implicitOverlayContext = null;
  const rootFallbackBaseZIndex = 2147483000;
  const rootFallbackMaxZIndex = 2147483646;

  openDocsButton.hidden = globalSections.length === 0;

  if (window.mermaid) {
    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      themeVariables: {
        primaryColor: "#F0F9FF",
        primaryTextColor: "#223355",
        primaryBorderColor: "#3388FF",
        lineColor: "#6B7A99",
        secondaryColor: "#E8F4FF",
        tertiaryColor: "#F5F7FA",
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif',
        fontSize: "14px"
      },
      flowchart: { curve: "basis", htmlLabels: true }
    });
  }

  function readPreferences() {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || "{}") || {};
    } catch (error) {
      return {};
    }
  }

  function savePreferences() {
    if (isReviewMode()) return;
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      const launcherRect = launcher.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const preferences = {
        launcher: { left: launcherRect.left, top: launcherRect.top },
        panel: {
          left: panelRect.left,
          top: panelRect.top,
          width: panel.classList.contains("is-collapsed") ? restoredPanelSize.width : panelRect.width,
          height: panel.classList.contains("is-collapsed") ? restoredPanelSize.height : panelRect.height
        }
      };
      try {
        localStorage.setItem(storageKey, JSON.stringify(preferences));
      } catch (error) {}
    }, 120);
  }

  function restorePreferences() {
    const preferences = readPreferences();
    if (preferences.launcher) {
      launcher.style.left = `${preferences.launcher.left}px`;
      launcher.style.top = `${preferences.launcher.top}px`;
      launcher.style.right = "auto";
      launcher.style.bottom = "auto";
    }
    if (preferences.panel) {
      const width = Math.max(320, Number(preferences.panel.width) || 440);
      const height = Math.max(220, Number(preferences.panel.height) || 460);
      restoredPanelSize = { width, height };
      panel.style.left = `${Number(preferences.panel.left) || Math.max(24, window.innerWidth - width - 88)}px`;
      panel.style.top = `${Number(preferences.panel.top) || 92}px`;
      panel.style.width = `${width}px`;
      panel.style.height = `${height}px`;
    } else {
      panel.style.left = `${Math.max(24, window.innerWidth - 528)}px`;
      panel.style.top = "92px";
    }
  }

  function isElementVisible(element, requireViewport = false) {
    if (!element) return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    if (element.hidden || element.getAttribute("aria-hidden") === "true") return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    if (!requireViewport) return true;
    return rect.right > 0 && rect.bottom > 0 && rect.left < window.innerWidth && rect.top < window.innerHeight;
  }

  function isScopeCandidateVisible(item) {
    if (!item?.node || !isElementVisible(item.node, true)) return false;
    if (item.layer > 0 || !item.scope.startsWith("page:")) {
      const style = getComputedStyle(item.node);
      if (style.pointerEvents === "none") return false;
    }
    return true;
  }

  function rememberImplicitOverlayScope(target) {
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
    implicitOverlayContext = { scope, kind };
    scheduleContextRefresh(true);
  }

  function getImplicitOverlayContext() {
    if (!implicitOverlayContext) return null;
    const selectors = implicitOverlayContext.kind === "drawer"
      ? ".drawer-overlay.open,.drawer.open,[data-drawer-overlay].open,[data-drawer-overlay][aria-hidden='false']"
      : ".modal-overlay.open,.dialog-overlay.open,.modal.open,.dialog.open,[role='dialog'][aria-modal='true']";
    const overlays = Array.from(document.querySelectorAll(selectors))
      .filter(node => isElementVisible(node, true));
    if (!overlays.length) return null;
    overlays.sort((a, b) => {
      const zA = Number.parseInt(getComputedStyle(a).zIndex, 10) || 0;
      const zB = Number.parseInt(getComputedStyle(b).zIndex, 10) || 0;
      return zA - zB || (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    });
    const overlay = overlays[overlays.length - 1];
    const panelSelector = implicitOverlayContext.kind === "drawer"
      ? ".drawer,[role='dialog'],aside"
      : "[role='dialog'],.modal,.dialog";
    const panel = Array.from(overlay.querySelectorAll(panelSelector)).find(node => isElementVisible(node, true));
    return {
      node: panel || overlay,
      scope: implicitOverlayContext.scope,
      layer: implicitOverlayContext.kind === "drawer" ? 20 : 30,
      implicit: true
    };
  }

  function isElementRenderable(element, scopeNode) {
    if (!element || !element.isConnected) return false;
    let current = element;
    while (current && current.nodeType === 1) {
      const style = getComputedStyle(current);
      if (current.hidden || current.getAttribute("aria-hidden") === "true") return false;
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
      if (current === scopeNode || current === document.body) break;
      current = current.parentElement;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isElementUndersized(element) {
    const rect = element.getBoundingClientRect();
    return rect.width < 4 || rect.height < 4;
  }

  function getClippedTargetRect(target) {
    if (!target) return null;
    const original = target.getBoundingClientRect();
    let left = Math.max(0, original.left);
    let top = Math.max(0, original.top);
    let right = Math.min(window.innerWidth, original.right);
    let bottom = Math.min(window.innerHeight, original.bottom);
    let parent = target.parentElement;

    while (parent && parent !== document.body) {
      const style = getComputedStyle(parent);
      if (parent === reviewPrototypeFrame || /(auto|scroll|hidden|clip)/.test(`${style.overflow}${style.overflowX}${style.overflowY}`)) {
        const rect = parent.getBoundingClientRect();
        left = Math.max(left, rect.left);
        top = Math.max(top, rect.top);
        right = Math.min(right, rect.right);
        bottom = Math.min(bottom, rect.bottom);
      }
      parent = parent.parentElement;
    }

    if (right <= left || bottom <= top) return null;
    return { original, visible: { left, top, right, bottom } };
  }

  function isPopoverOpen() {
    try {
      return root.matches(":popover-open");
    } catch (error) {
      return false;
    }
  }

  function inspectHostLayers() {
    let maxZIndex = 0;
    let maxElement = null;
    document.body.querySelectorAll("*").forEach(element => {
      if (element === root || root.contains(element)) return;
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return;
      const zIndex = Number.parseInt(style.zIndex, 10);
      if (!Number.isFinite(zIndex) || zIndex <= maxZIndex) return;
      maxZIndex = zIndex;
      maxElement = element;
    });
    return {
      maxZIndex,
      maxElement: maxElement ? `${maxElement.tagName.toLowerCase()}${maxElement.id ? `#${maxElement.id}` : ""}${maxElement.classList.length ? `.${Array.from(maxElement.classList).join(".")}` : ""}` : ""
    };
  }

  function ensureAnnotationLayer(reorderTopLayer = false) {
    const supportsPopover = typeof root.showPopover === "function" && typeof root.hidePopover === "function";
    if (supportsPopover) {
      try {
        if (reorderTopLayer && isPopoverOpen()) root.hidePopover();
        if (!isPopoverOpen()) root.showPopover();
        root.dataset.protoWebLayerMode = "top-layer";
        if (root.style.zIndex !== String(rootFallbackMaxZIndex)) root.style.zIndex = String(rootFallbackMaxZIndex);
        return;
      } catch (error) {
        console.warn("标注层进入浏览器 top layer 失败，已切换到 z-index 兜底", error);
      }
    }

    root.removeAttribute("popover");
    const audit = inspectHostLayers();
    const nextZIndex = Math.min(rootFallbackMaxZIndex, Math.max(rootFallbackBaseZIndex, audit.maxZIndex + 100));
    if (root.style.zIndex !== String(nextZIndex)) root.style.zIndex = String(nextZIndex);
    root.dataset.protoWebLayerMode = "z-index";
    if (audit.maxZIndex >= rootFallbackMaxZIndex) {
      console.error("业务界面已占用浏览器最大 z-index，无法保证标注层始终位于最上层", audit);
    }
  }

  function getLauncherHitAudit() {
    const rect = launcher.getBoundingClientRect();
    const x = Math.min(window.innerWidth - 1, Math.max(0, rect.left + rect.width / 2));
    const y = Math.min(window.innerHeight - 1, Math.max(0, rect.top + rect.height / 2));
    const hit = document.elementFromPoint(x, y);
    return {
      clickable: Boolean(hit && (hit === launcher || launcher.contains(hit))),
      hitElement: hit ? `${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : ""}` : "",
      point: { x, y }
    };
  }

  function scheduleAnnotationAudit() {
    window.clearTimeout(annotationAuditTimer);
    annotationAuditTimer = window.setTimeout(() => {
      ensureAnnotationLayer(false);
      const hitAudit = getLauncherHitAudit();
      root.dataset.protoWebLauncherClickable = String(hitAudit.clickable);
      if (!hitAudit.clickable) {
        ensureAnnotationLayer(true);
        requestAnimationFrame(() => {
          const repairedAudit = getLauncherHitAudit();
          root.dataset.protoWebLauncherClickable = String(repairedAudit.clickable);
          if (!repairedAudit.clickable) console.error("原型标注入口被业务界面遮挡", repairedAudit);
        });
      }
    }, 40);
  }

  function getScopeContext() {
    const candidates = Array.from(document.querySelectorAll("[data-proto-scope]"))
      .map((node, index) => ({
        node,
        index,
        scope: node.dataset.protoScope,
        layer: Number(node.dataset.protoLayer) || 0
      }))
      .filter(item => item.scope && isScopeCandidateVisible(item));

    const explicitOverlays = candidates.filter(item => item.layer > 0 || !item.scope.startsWith("page:"));
    if (explicitOverlays.length) {
      explicitOverlays.sort((a, b) => a.layer - b.layer || a.index - b.index);
      return explicitOverlays[explicitOverlays.length - 1];
    }

    const implicitOverlay = getImplicitOverlayContext();
    if (implicitOverlay) return implicitOverlay;

    if (candidates.length) {
      candidates.sort((a, b) => a.layer - b.layer || a.index - b.index);
      return candidates[candidates.length - 1];
    }

    const activePage = document.querySelector(".page.active[id]");
    if (activePage) {
      return { node: activePage, scope: `page:${activePage.id.replace(/^page-/, "")}`, layer: 0 };
    }

    return { node: document.body, scope: document.body.dataset.protoScope || "page:default", layer: 0 };
  }

  function getScopeNotes(scope = getScopeContext().scope) {
    return annotations.filter(note => note.scope === scope || (scope.startsWith("page:") && note.scope === "page:*"));
  }

  function findTarget(note, scopeNode) {
    if (!note.target) return null;
    try {
      if (scopeNode?.matches?.(note.target)) return scopeNode;
      return scopeNode?.querySelector?.(note.target) || document.querySelector(note.target);
    } catch (error) {
      console.warn(`标注 ${note.id || note.title || "未命名"} 的 target 选择器无效`, error);
      return null;
    }
  }

  function getRenderableScopeNotes(context = getScopeContext()) {
    return getScopeNotes(context.scope).filter(note => isElementRenderable(findTarget(note, context.node), context.node));
  }

  function renderMarkers() {
    const context = getScopeContext();
    const notes = getRenderableScopeNotes(context);
    const existingMarkers = new Map(Array.from(markerLayer.querySelectorAll(".protoWeb-marker"))
      .map(marker => [marker.dataset.annotationId, marker]));
    const desiredIds = new Set();
    launcherCount.textContent = String(notes.length);
    menuCount.textContent = `当前页面 ${notes.length} 条`;
    launcher.title = `打开原型标注菜单（当前页面 ${notes.length} 条）`;
    pageToggle.setAttribute("aria-checked", String(enabled));
    pageToggle.setAttribute("aria-label", enabled ? "隐藏页面标注" : "显示页面标注");
    if (!enabled || docsBackdrop.classList.contains("is-open")) {
      existingMarkers.forEach(marker => marker.remove());
      return;
    }

    notes.forEach((note, index) => {
      const target = findTarget(note, context.node);
      if (!isElementVisible(target, true)) return;
      const clipped = getClippedTargetRect(target);
      if (!clipped) return;
      const xValue = Number(note.x);
      const yValue = Number(note.y);
      const x = Number.isFinite(xValue) ? Math.min(1, Math.max(0, xValue)) : 0.5;
      const y = Number.isFinite(yValue) ? Math.min(1, Math.max(0, yValue)) : 0.5;
      const left = Math.max(clipped.visible.left, Math.min(clipped.visible.right, clipped.original.left + clipped.original.width * x));
      const top = Math.max(clipped.visible.top, Math.min(clipped.visible.bottom, clipped.original.top + clipped.original.height * y));
      desiredIds.add(note.id);
      let marker = existingMarkers.get(note.id);
      if (!marker) {
        marker = document.createElement("button");
        marker.type = "button";
        marker.className = "protoWeb-marker";
        marker.dataset.annotationId = note.id;
        marker.addEventListener("click", event => {
          event.stopPropagation();
          const boundNote = marker.__protoWebNote;
          if (!boundNote) return;
          if (isReviewMode()) {
            setReviewActiveNote(boundNote.id);
            scrollReviewCardIntoView(boundNote.id);
          } else {
            openNote(boundNote, marker.__protoWebScopeNotes, marker.__protoWebScope);
          }
        });
      }
      marker.__protoWebNote = note;
      marker.__protoWebScopeNotes = notes;
      marker.__protoWebScope = context.scope;
      marker.classList.toggle("is-active", note.id === currentNoteId);
      marker.textContent = String(index + 1);
      marker.style.left = `${left}px`;
      marker.style.top = `${top}px`;
      marker.title = note.title;
      marker.setAttribute("aria-label", `标注 ${index + 1}：${note.title}`);
      const currentAtIndex = markerLayer.children[index];
      if (currentAtIndex !== marker) markerLayer.insertBefore(marker, currentAtIndex || null);
    });
    existingMarkers.forEach((marker, id) => {
      if (!desiredIds.has(id)) marker.remove();
    });
  }

  function scheduleMarkerLayout() {
    if (layoutFrame) return;
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = 0;
      renderMarkers();
    });
  }

  function clampPanel() {
    if (!panel.classList.contains("is-open")) return;
    const rect = panel.getBoundingClientRect();
    const margin = 12;
    const left = Math.min(Math.max(margin, rect.left), Math.max(margin, window.innerWidth - rect.width - margin));
    const top = Math.min(Math.max(margin, rect.top), Math.max(margin, window.innerHeight - rect.height - margin));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  function clampLauncher() {
    if (isReviewMode() || !isElementVisible(launcher)) return;
    const rect = launcher.getBoundingClientRect();
    if (!launcher.style.left) return;
    launcher.style.left = `${Math.min(Math.max(8, rect.left), window.innerWidth - rect.width - 8)}px`;
    launcher.style.top = `${Math.min(Math.max(8, rect.top), window.innerHeight - rect.height - 8)}px`;
  }

  function positionMenu() {
    if (!menu.classList.contains("is-open")) return;
    const launcherRect = launcher.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(Math.max(margin, launcherRect.right - menuRect.width), window.innerWidth - menuRect.width - margin);
    let top = launcherRect.top - menuRect.height - 10;
    if (top < margin) top = launcherRect.bottom + 10;
    top = Math.min(top, window.innerHeight - menuRect.height - margin);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function closeMenu() {
    menu.classList.remove("is-open");
    launcher.setAttribute("aria-expanded", "false");
  }

  function toggleMenu() {
    const willOpen = !menu.classList.contains("is-open");
    menu.classList.toggle("is-open", willOpen);
    launcher.setAttribute("aria-expanded", String(willOpen));
    if (willOpen) positionMenu();
  }

  async function renderMermaidBlocks(renderRoot) {
    if (!window.mermaid) return;
    const blocks = Array.from(renderRoot.querySelectorAll("pre code.language-mermaid"));
    for (const block of blocks) {
      const pre = block.closest("pre");
      const container = document.createElement("div");
      container.className = "protoWeb-mermaid";
      try {
        const result = await window.mermaid.render(`protoWeb-mermaid-${++mermaidRenderCounter}`, block.textContent.trim());
        container.innerHTML = result.svg;
        if (result.bindFunctions) result.bindFunctions(container);
        pre.replaceWith(container);
      } catch (error) {
        pre.classList.add("protoWeb-mermaid-error");
        console.error("标注流程图渲染失败", error);
      }
    }
  }

  async function renderRichContent(renderRoot, item) {
    if (item.format === "html" || !window.marked) {
      renderRoot.innerHTML = item.content || "";
    } else {
      renderRoot.innerHTML = window.marked.parse(item.content || "", { gfm: true, breaks: true });
    }
    await renderMermaidBlocks(renderRoot);
  }

  async function renderPanel(note, notes = currentPanelNotes) {
    const index = notes.findIndex(item => item.id === note.id);
    panelHeading.textContent = note.title;
    await renderRichContent(content, note);
    pageCount.textContent = `${index + 1} / ${notes.length}`;
    prevButton.disabled = index <= 0;
    nextButton.disabled = index < 0 || index >= notes.length - 1;
  }

  function openNote(noteOrId, scopeNotes = null, scope = "") {
    const note = typeof noteOrId === "object"
      ? noteOrId
      : annotations.find(item => item.id === noteOrId);
    if (!note) {
      console.warn("未找到要打开的标注", noteOrId);
      return;
    }
    const context = getScopeContext();
    const fallbackNotes = getRenderableScopeNotes(context);
    const candidateNotes = Array.isArray(scopeNotes) && scopeNotes.some(item => item.id === note.id)
      ? scopeNotes
      : fallbackNotes;
    currentPanelNotes = candidateNotes.some(item => item.id === note.id) ? candidateNotes : [note];
    currentPanelScope = scope || context.scope;
    panelScopeMismatchSince = 0;
    currentNoteId = note.id;
    panel.classList.add("is-open");
    panel.classList.remove("is-collapsed");
    collapseButton.textContent = "−";
    collapseButton.title = "收起标注窗口";
    renderPanel(note, currentPanelNotes).catch(error => {
      console.error("标注内容渲染失败", error);
      content.innerHTML = "<p>标注内容暂时无法显示。</p>";
    });
    requestAnimationFrame(() => {
      clampPanel();
      renderMarkers();
    });
  }

  function closePanel() {
    currentNoteId = "";
    currentPanelNotes = [];
    currentPanelScope = "";
    panelScopeMismatchSince = 0;
    panel.classList.remove("is-open", "is-collapsed");
    collapseButton.textContent = "−";
    renderMarkers();
  }

  function movePanel(step) {
    const notes = currentPanelNotes.length ? currentPanelNotes : getRenderableScopeNotes();
    const index = notes.findIndex(note => note.id === currentNoteId);
    const targetIndex = index + step;
    if (targetIndex >= 0 && targetIndex < notes.length) openNote(notes[targetIndex], notes, currentPanelScope);
  }

  function toggleAnnotations() {
    enabled = !enabled;
    launcher.classList.toggle("is-active", enabled);
    pageToggle.setAttribute("aria-checked", String(enabled));
    syncReviewToggle();
    if (!enabled) closePanel();
    else renderMarkers();
  }

  function renderGlobalNav() {
    docsNav.replaceChildren();
    globalSections.forEach(section => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = section.title;
      button.classList.toggle("is-active", section.id === currentGlobalSectionId);
      button.addEventListener("click", () => renderGlobalSection(section.id));
      docsNav.appendChild(button);
    });
  }

  async function renderGlobalSection(id) {
    const section = globalSections.find(item => item.id === id) || globalSections[0];
    if (!section) return;
    currentGlobalSectionId = section.id;
    renderGlobalNav();
    docsBody.scrollTop = 0;
    try {
      await renderRichContent(docsContent, section);
    } catch (error) {
      console.error("全局原型说明渲染失败", error);
      docsContent.innerHTML = "<p>原型说明暂时无法显示。</p>";
    }
  }

  function openGlobalDocs() {
    if (!globalSections.length) return;
    closeMenu();
    docsBackdrop.classList.add("is-open");
    closePanel();
    markerLayer.replaceChildren();
    const meta = annotationData.globalMeta || {};
    docsMeta.textContent = `${meta.version || "V0.1"} · 更新于 ${meta.updatedAt || "未记录"}`;
    renderGlobalSection(currentGlobalSectionId || globalSections[0].id);
    requestAnimationFrame(() => docsCloseButton.focus());
  }

  function closeGlobalDocs() {
    docsBackdrop.classList.remove("is-open");
    renderMarkers();
    launcher.focus();
  }

  function isReviewMode() {
    return document.body.classList.contains("protoWeb-review-mode");
  }

  function readReviewPreferences() {
    try {
      return JSON.parse(localStorage.getItem(reviewStorageKey) || "{}") || {};
    } catch (error) {
      return {};
    }
  }

  function getDefaultReviewSideWidth(side) {
    if (window.innerWidth <= 1440) return side === "left" ? 300 : 340;
    return side === "left" ? 360 : 380;
  }

  function getReviewSideWidth(side) {
    const property = side === "left" ? "--protoWeb-review-left-width" : "--protoWeb-review-right-width";
    return Number.parseFloat(getComputedStyle(reviewWorkspace).getPropertyValue(property)) || getDefaultReviewSideWidth(side);
  }

  function setReviewSideWidth(side, requestedWidth) {
    const minimum = side === "left" ? 260 : 300;
    const hardMaximum = side === "left" ? 760 : 640;
    const otherSide = side === "left" ? "right" : "left";
    const ownCollapsed = reviewWorkspace.classList.contains(side === "left" ? "is-left-collapsed" : "is-right-collapsed");
    const otherCollapsed = reviewWorkspace.classList.contains(otherSide === "left" ? "is-left-collapsed" : "is-right-collapsed");
    const otherTrack = otherCollapsed ? 44 : getReviewSideWidth(otherSide);
    const splitterWidth = (ownCollapsed ? 0 : 8) + (otherCollapsed ? 0 : 8);
    const availableMaximum = window.innerWidth - otherTrack - splitterWidth - 420;
    const maximum = Math.max(minimum, Math.min(hardMaximum, availableMaximum));
    const width = Math.round(Math.min(maximum, Math.max(minimum, Number(requestedWidth) || getDefaultReviewSideWidth(side))));
    const property = side === "left" ? "--protoWeb-review-left-width" : "--protoWeb-review-right-width";
    if (Math.abs(getReviewSideWidth(side) - width) > 0.5) reviewWorkspace.style.setProperty(property, `${width}px`);
    const splitter = side === "left" ? reviewLeftSplitter : reviewRightSplitter;
    splitter?.setAttribute("aria-valuemin", String(minimum));
    splitter?.setAttribute("aria-valuemax", String(maximum));
    splitter?.setAttribute("aria-valuenow", String(width));
    return width;
  }

  function normalizeReviewSideWidths() {
    setReviewSideWidth("left", getReviewSideWidth("left"));
    setReviewSideWidth("right", getReviewSideWidth("right"));
  }

  function saveReviewPreferences() {
    try {
      localStorage.setItem(reviewStorageKey, JSON.stringify({
        leftCollapsed: reviewWorkspace.classList.contains("is-left-collapsed"),
        rightCollapsed: reviewWorkspace.classList.contains("is-right-collapsed"),
        leftWidth: getReviewSideWidth("left"),
        rightWidth: getReviewSideWidth("right")
      }));
    } catch (error) {}
  }

  function applyReviewPreferences() {
    const preferences = readReviewPreferences();
    reviewWorkspace.classList.toggle("is-left-collapsed", Boolean(preferences.leftCollapsed));
    reviewWorkspace.classList.toggle("is-right-collapsed", Boolean(preferences.rightCollapsed));
    setReviewSideWidth("left", Number(preferences.leftWidth) || getDefaultReviewSideWidth("left"));
    setReviewSideWidth("right", Number(preferences.rightWidth) || getDefaultReviewSideWidth("right"));
  }

  function setReviewSideCollapsed(side, collapsed) {
    reviewWorkspace.classList.toggle(side === "left" ? "is-left-collapsed" : "is-right-collapsed", collapsed);
    normalizeReviewSideWidths();
    saveReviewPreferences();
    scheduleReviewLayout();
  }

  function getReviewBusinessNodes() {
    const explicitNodes = Array.from(document.querySelectorAll("[data-proto-app], [data-proto-portal]"))
      .filter(node => !root.contains(node));
    if (explicitNodes.length) return explicitNodes;
    return Array.from(document.body.children).filter(node => {
      if (node === root || node === dataNode) return false;
      return !["SCRIPT", "STYLE", "LINK", "TEMPLATE"].includes(node.tagName);
    });
  }

  function moveBusinessIntoReviewFrame() {
    getReviewBusinessNodes().forEach(node => {
      if (!reviewPlacementAnchors.has(node)) {
        const anchor = document.createComment(`protoWeb-review-anchor:${node.id || node.className || node.tagName}`);
        node.parentNode.insertBefore(anchor, node);
        reviewPlacementAnchors.set(node, anchor);
      }
      reviewPrototypeFrame.appendChild(node);
    });
  }

  function restoreBusinessFromReviewFrame() {
    reviewPlacementAnchors.forEach((anchor, node) => {
      if (anchor.parentNode) anchor.parentNode.insertBefore(node, anchor.nextSibling);
    });
  }

  function captureLauncherPlacement() {
    launcherPlacementBeforeReview = {
      left: launcher.style.left,
      top: launcher.style.top,
      right: launcher.style.right,
      bottom: launcher.style.bottom
    };
  }

  function restoreLauncherPlacement() {
    if (!launcherPlacementBeforeReview) return;
    Object.assign(launcher.style, launcherPlacementBeforeReview);
    launcherPlacementBeforeReview = null;
  }

  function layoutReviewPrototype() {
    reviewLayoutFrame = 0;
    if (!isReviewMode()) return;
    normalizeReviewSideWidths();
    reviewPrototypeFrame.style.width = `${reviewDesignWidth}px`;
    reviewPrototypeFrame.style.height = `${reviewDesignHeight}px`;
    const availableWidth = Math.max(1, reviewCanvas.clientWidth - reviewCanvasMargin * 2);
    const availableHeight = Math.max(1, reviewCanvas.clientHeight - reviewCanvasMargin * 2);
    const scale = Math.min(availableWidth / reviewDesignWidth, availableHeight / reviewDesignHeight);
    const left = Math.round((reviewCanvas.clientWidth - reviewDesignWidth * scale) / 2);
    const top = Math.round((reviewCanvas.clientHeight - reviewDesignHeight * scale) / 2);
    reviewPrototypeFrame.style.transform = `translate(${left}px, ${top}px) scale(${scale})`;
    reviewPrototypeFrame.dataset.scale = scale.toFixed(4);
    scheduleMarkerLayout();
    scheduleAnnotationAudit();
  }

  function scheduleReviewLayout() {
    if (!isReviewMode() || reviewLayoutFrame) return;
    reviewLayoutFrame = requestAnimationFrame(layoutReviewPrototype);
  }

  function makeReviewSplitterDraggable(splitter, side) {
    if (!splitter) return;
    let dragState = null;
    splitter.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      dragState = { pointerId: event.pointerId, startX: event.clientX, startWidth: getReviewSideWidth(side) };
      splitter.setPointerCapture(event.pointerId);
      splitter.classList.add("is-dragging");
      reviewWorkspace.classList.add("is-resizing");
      event.preventDefault();
    });
    splitter.addEventListener("pointermove", event => {
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      const delta = event.clientX - dragState.startX;
      setReviewSideWidth(side, dragState.startWidth + (side === "left" ? delta : -delta));
      scheduleReviewLayout();
    });
    const endDrag = event => {
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      dragState = null;
      splitter.classList.remove("is-dragging");
      reviewWorkspace.classList.remove("is-resizing");
      saveReviewPreferences();
      scheduleReviewLayout();
    };
    splitter.addEventListener("pointerup", endDrag);
    splitter.addEventListener("pointercancel", endDrag);
  }

  function renderReviewDocsNav() {
    reviewDocsNav.replaceChildren();
    globalSections.forEach(section => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = section.title;
      button.classList.toggle("is-active", section.id === currentGlobalSectionId);
      button.addEventListener("click", () => renderReviewSection(section.id));
      reviewDocsNav.appendChild(button);
    });
  }

  async function renderReviewSection(id) {
    const section = globalSections.find(item => item.id === id) || globalSections[0];
    if (!section) {
      reviewDocsNav.replaceChildren();
      reviewDocsBody.innerHTML = '<div class="protoWeb-review-empty">暂无原型说明</div>';
      return;
    }
    currentGlobalSectionId = section.id;
    renderReviewDocsNav();
    reviewDocsBody.scrollTop = 0;
    await renderRichContent(reviewDocsBody, section);
  }

  function getReviewScopeLabel(context) {
    const scopeNode = context.node;
    const activeNav = document.querySelector("[data-proto-page].active, [data-page-link].active, .nav-leaf.active, .menu-item.active");
    return scopeNode?.dataset?.protoWebTitle || activeNav?.textContent?.trim() || context.scope.replace(/^(page|drawer|modal):/, "");
  }

  function syncReviewToggle() {
    if (!reviewNoteToggle) return;
    reviewNoteToggle.setAttribute("aria-checked", String(enabled));
    reviewNoteToggle.setAttribute("aria-label", enabled ? "隐藏页面标注" : "显示页面标注");
  }

  function setReviewActiveNote(noteId) {
    reviewActiveNoteId = noteId;
    reviewNoteList.querySelectorAll(".protoWeb-review-note-card").forEach(card => card.classList.toggle("is-active", card.dataset.noteId === noteId));
    markerLayer.querySelectorAll(".protoWeb-marker").forEach(marker => marker.classList.toggle("is-active", marker.dataset.annotationId === noteId));
  }

  function scrollReviewCardIntoView(noteId) {
    const card = Array.from(reviewNoteList.querySelectorAll(".protoWeb-review-note-card")).find(item => item.dataset.noteId === noteId);
    if (!card) return;
    const listRect = reviewNoteList.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const top = cardRect.top - listRect.top + reviewNoteList.scrollTop - (reviewNoteList.clientHeight - cardRect.height) / 2;
    reviewNoteList.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    card.focus({ preventScroll: true });
  }

  function highlightReviewTarget(target) {
    document.querySelectorAll(".protoWeb-review-target-highlight").forEach(node => node.classList.remove("protoWeb-review-target-highlight"));
    target.classList.add("protoWeb-review-target-highlight");
    window.setTimeout(() => target.classList.remove("protoWeb-review-target-highlight"), 1200);
  }

  function findReviewScrollParent(target) {
    let parent = target.parentElement;
    while (parent && parent !== reviewPrototypeFrame) {
      const style = getComputedStyle(parent);
      if ((parent.hasAttribute("data-proto-scroll-container") || /(auto|scroll)/.test(style.overflowY)) && parent.scrollHeight > parent.clientHeight + 1) return parent;
      parent = parent.parentElement;
    }
    return null;
  }

  function locateReviewTarget(note) {
    const context = getScopeContext();
    const target = findTarget(note, context.node);
    if (!isElementRenderable(target, context.node)) return;
    setReviewActiveNote(note.id);
    if (note.scroll === false || target.getAttribute("data-proto-scroll") === "none") {
      highlightReviewTarget(target);
      return;
    }
    const scroller = findReviewScrollParent(target);
    if (!scroller) {
      highlightReviewTarget(target);
      return;
    }
    const scrollerRect = scroller.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    if (targetRect.top >= scrollerRect.top && targetRect.bottom <= scrollerRect.bottom) {
      highlightReviewTarget(target);
      return;
    }
    const scale = Number(reviewPrototypeFrame.dataset.scale) || 1;
    const targetTop = (targetRect.top - scrollerRect.top) / scale + scroller.scrollTop;
    const targetHeight = targetRect.height / scale;
    const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const nextTop = Math.min(maxTop, Math.max(0, targetTop - (scroller.clientHeight - targetHeight) / 2));
    scroller.scrollTo({ top: nextTop, behavior: "smooth" });
    window.setTimeout(() => highlightReviewTarget(target), 360);
  }

  async function renderReviewNoteList(context = getScopeContext(), notes = getRenderableScopeNotes(context), signature = "") {
    const renderVersion = ++reviewRenderVersion;
    reviewScopeLabel.textContent = getReviewScopeLabel(context);
    reviewNoteCount.textContent = `${notes.length} 条`;
    syncReviewToggle();
    if (!notes.length) {
      if (renderVersion === reviewRenderVersion) {
        reviewNoteList.innerHTML = '<div class="protoWeb-review-empty">当前页面暂无标注</div>';
        reviewContextSignature = signature;
      }
      return;
    }
    const listRoot = document.createElement("div");
    reviewNoteList.replaceChildren(listRoot);
    for (const [index, note] of notes.entries()) {
      if (renderVersion !== reviewRenderVersion) return;
      const card = document.createElement("article");
      card.className = "protoWeb-review-note-card";
      card.dataset.noteId = note.id;
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", `定位标注 ${index + 1}：${note.title}`);
      const number = document.createElement("span");
      number.className = "protoWeb-review-note-index";
      number.textContent = String(index + 1);
      const heading = document.createElement("h3");
      heading.textContent = note.title;
      const body = document.createElement("div");
      body.className = "protoWeb-content";
      card.append(number, heading, body);
      const locate = () => locateReviewTarget(note);
      card.addEventListener("click", locate);
      card.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          locate();
        }
      });
      listRoot.appendChild(card);
      await renderRichContent(body, note);
    }
    if (renderVersion !== reviewRenderVersion) return;
    reviewContextSignature = signature;
    setReviewActiveNote(notes.some(note => note.id === reviewActiveNoteId) ? reviewActiveNoteId : "");
  }

  function syncReviewContext() {
    if (!isReviewMode()) return;
    const context = getScopeContext();
    const notes = getRenderableScopeNotes(context);
    if (!notes.some(note => note.id === reviewActiveNoteId)) reviewActiveNoteId = "";
    const signature = `${context.scope}|${enabled ? 1 : 0}|${notes.map(note => note.id).join(",")}`;
    if (signature !== reviewContextSignature && signature !== reviewPendingSignature) {
      reviewPendingSignature = signature;
      renderReviewNoteList(context, notes, signature)
        .catch(error => console.error("三栏审阅标注列表渲染失败", error))
        .finally(() => {
          if (reviewPendingSignature === signature) reviewPendingSignature = "";
        });
    } else {
      setReviewActiveNote(reviewActiveNoteId);
    }
    scheduleReviewLayout();
  }

  function scheduleReviewSync() {
    if (!isReviewMode() || reviewSyncFrame) return;
    reviewSyncFrame = requestAnimationFrame(() => {
      reviewSyncFrame = 0;
      syncReviewContext();
    });
  }

  function enterReviewMode() {
    if (isReviewMode()) return;
    reviewContextSignature = "";
    reviewPendingSignature = "";
    captureLauncherPlacement();
    moveBusinessIntoReviewFrame();
    applyReviewPreferences();
    reviewWorkspace.hidden = false;
    document.body.classList.add("protoWeb-review-mode");
    closeMenu();
    closePanel();
    docsBackdrop.classList.remove("is-open");
    enabled = true;
    launcher.classList.add("is-active");
    pageToggle.setAttribute("aria-checked", "true");
    syncReviewToggle();
    renderReviewSection(currentGlobalSectionId).catch(error => console.error("三栏审阅原型说明渲染失败", error));
    requestAnimationFrame(() => {
      layoutReviewPrototype();
      syncReviewContext();
    });
  }

  function exitReviewMode() {
    if (!isReviewMode()) return;
    reviewRenderVersion += 1;
    reviewContextSignature = "";
    reviewPendingSignature = "";
    document.body.classList.remove("protoWeb-review-mode");
    restoreBusinessFromReviewFrame();
    restoreLauncherPlacement();
    reviewWorkspace.hidden = true;
    document.querySelectorAll(".protoWeb-review-target-highlight").forEach(node => node.classList.remove("protoWeb-review-target-highlight"));
    ensureAnnotationLayer(true);
    requestAnimationFrame(() => {
      clampLauncher();
      renderMarkers();
      scheduleAnnotationAudit();
    });
  }

  function syncContext() {
    ensureAnnotationLayer(false);
    const context = getScopeContext();
    const contextNotes = getRenderableScopeNotes(context);
    if (currentNoteId) {
      if (contextNotes.some(note => note.id === currentNoteId)) {
        currentPanelNotes = contextNotes;
        currentPanelScope = context.scope;
        panelScopeMismatchSince = 0;
      } else if (!panelScopeMismatchSince) {
        panelScopeMismatchSince = performance.now();
      } else if (performance.now() - panelScopeMismatchSince >= 280) {
        closePanel();
      }
    }
    scheduleMarkerLayout();
    scheduleReviewSync();
    scheduleAnnotationAudit();
  }

  function runContextRefresh() {
    contextRefreshFrame = 0;
    syncContext();
    if (performance.now() < contextRefreshUntil) {
      contextRefreshFrame = requestAnimationFrame(runContextRefresh);
    }
  }

  function scheduleContextRefresh(settle = false) {
    if (settle === true) {
      contextRefreshUntil = Math.max(contextRefreshUntil, performance.now() + 900);
    }
    if (!contextRefreshFrame) contextRefreshFrame = requestAnimationFrame(runContextRefresh);
  }

  function makeDraggable(handle, target, onEnd) {
    let dragState = null;
    handle.addEventListener("pointerdown", event => {
      if (event.button !== 0 || event.target.closest("button")) return;
      const rect = target.getBoundingClientRect();
      dragState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      };
      target.style.left = `${rect.left}px`;
      target.style.top = `${rect.top}px`;
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    handle.addEventListener("pointermove", event => {
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      const margin = 12;
      const left = Math.min(Math.max(margin, dragState.left + event.clientX - dragState.startX), window.innerWidth - dragState.width - margin);
      const top = Math.min(Math.max(margin, dragState.top + event.clientY - dragState.startY), window.innerHeight - dragState.height - margin);
      target.style.left = `${left}px`;
      target.style.top = `${top}px`;
    });
    const endDrag = event => {
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      dragState = null;
      onEnd?.();
    };
    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", endDrag);
  }

  function makeResizable() {
    document.querySelectorAll(".protoWeb-resize-handle").forEach(handle => {
      let resizeState = null;
      handle.addEventListener("pointerdown", event => {
        if (event.button !== 0 || panel.classList.contains("is-collapsed")) return;
        const rect = panel.getBoundingClientRect();
        resizeState = {
          pointerId: event.pointerId,
          direction: handle.dataset.direction,
          startX: event.clientX,
          startY: event.clientY,
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height
        };
        handle.setPointerCapture(event.pointerId);
        event.preventDefault();
        event.stopPropagation();
      });
      handle.addEventListener("pointermove", event => {
        if (!resizeState || event.pointerId !== resizeState.pointerId) return;
        const margin = 12;
        const minWidth = 320;
        const minHeight = 220;
        const dx = event.clientX - resizeState.startX;
        const dy = event.clientY - resizeState.startY;
        let left = resizeState.left;
        let top = resizeState.top;
        let width = resizeState.width;
        let height = resizeState.height;
        const direction = resizeState.direction;

        if (direction.includes("e")) width = Math.min(Math.max(minWidth, resizeState.width + dx), window.innerWidth - margin - resizeState.left);
        if (direction.includes("w")) {
          width = Math.min(Math.max(minWidth, resizeState.width - dx), resizeState.right - margin);
          left = resizeState.right - width;
        }
        if (direction.includes("s")) height = Math.min(Math.max(minHeight, resizeState.height + dy), window.innerHeight - margin - resizeState.top);
        if (direction.includes("n")) {
          height = Math.min(Math.max(minHeight, resizeState.height - dy), resizeState.bottom - margin);
          top = resizeState.bottom - height;
        }

        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
        panel.style.width = `${width}px`;
        panel.style.height = `${height}px`;
        restoredPanelSize = { width, height };
      });
      const endResize = event => {
        if (!resizeState || event.pointerId !== resizeState.pointerId) return;
        resizeState = null;
        clampPanel();
        savePreferences();
      };
      handle.addEventListener("pointerup", endResize);
      handle.addEventListener("pointercancel", endResize);
    });
  }

  let launcherDrag = null;
  let suppressLauncherClick = false;
  launcher.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    const rect = launcher.getBoundingClientRect();
    launcherDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      moved: false
    };
    launcher.style.left = `${rect.left}px`;
    launcher.style.top = `${rect.top}px`;
    launcher.style.right = "auto";
    launcher.style.bottom = "auto";
    launcher.setPointerCapture(event.pointerId);
  });
  launcher.addEventListener("pointermove", event => {
    if (!launcherDrag || event.pointerId !== launcherDrag.pointerId) return;
    const dx = event.clientX - launcherDrag.startX;
    const dy = event.clientY - launcherDrag.startY;
    if (Math.hypot(dx, dy) > 5) launcherDrag.moved = true;
    launcher.style.left = `${Math.min(Math.max(8, launcherDrag.left + dx), window.innerWidth - launcher.offsetWidth - 8)}px`;
    launcher.style.top = `${Math.min(Math.max(8, launcherDrag.top + dy), window.innerHeight - launcher.offsetHeight - 8)}px`;
    positionMenu();
  });
  launcher.addEventListener("pointerup", event => {
    if (!launcherDrag || event.pointerId !== launcherDrag.pointerId) return;
    suppressLauncherClick = launcherDrag.moved;
    launcherDrag = null;
    savePreferences();
  });
  launcher.addEventListener("click", event => {
    if (suppressLauncherClick) {
      suppressLauncherClick = false;
      event.preventDefault();
      return;
    }
    toggleMenu();
  });

  makeDraggable(panelHeader, panel, () => {
    clampPanel();
    savePreferences();
  });
  makeResizable();

  pageToggle.addEventListener("click", event => {
    event.stopPropagation();
    toggleAnnotations();
  });
  menuFloatModeButton.addEventListener("click", closeMenu);
  openReviewButton.addEventListener("click", enterReviewMode);
  reviewFloatModeButton.addEventListener("click", exitReviewMode);
  reviewColumnsModeButton.addEventListener("click", () => {});
  reviewCollapseLeftButton.addEventListener("click", () => setReviewSideCollapsed("left", true));
  reviewExpandLeftButton.addEventListener("click", () => setReviewSideCollapsed("left", false));
  reviewCollapseRightButton.addEventListener("click", () => setReviewSideCollapsed("right", true));
  reviewExpandRightButton.addEventListener("click", () => setReviewSideCollapsed("right", false));
  reviewNoteToggle.addEventListener("click", event => {
    event.stopPropagation();
    toggleAnnotations();
    scheduleReviewSync();
  });
  openDocsButton.addEventListener("click", openGlobalDocs);
  closeButton.addEventListener("click", closePanel);
  docsCloseButton.addEventListener("click", closeGlobalDocs);
  docsBackdrop.addEventListener("click", event => {
    if (event.target === docsBackdrop) closeGlobalDocs();
  });
  collapseButton.addEventListener("click", () => {
    const willCollapse = !panel.classList.contains("is-collapsed");
    if (willCollapse) {
      const rect = panel.getBoundingClientRect();
      restoredPanelSize = { width: Math.max(320, rect.width), height: Math.max(220, rect.height) };
      panel.classList.add("is-collapsed");
      panel.style.width = `${Math.min(360, restoredPanelSize.width)}px`;
      collapseButton.textContent = "+";
      collapseButton.title = "展开标注窗口";
    } else {
      panel.classList.remove("is-collapsed");
      panel.style.width = `${restoredPanelSize.width}px`;
      panel.style.height = `${restoredPanelSize.height}px`;
      collapseButton.textContent = "−";
      collapseButton.title = "收起标注窗口";
      requestAnimationFrame(clampPanel);
    }
    savePreferences();
  });
  prevButton.addEventListener("click", () => movePanel(-1));
  nextButton.addEventListener("click", () => movePanel(1));

  document.addEventListener("click", event => {
    rememberImplicitOverlayScope(event.target);
    if (!menu.contains(event.target) && !launcher.contains(event.target)) closeMenu();
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    if (docsBackdrop.classList.contains("is-open")) closeGlobalDocs();
    else if (menu.classList.contains("is-open")) closeMenu();
    else if (panel.classList.contains("is-open")) closePanel();
  });
  document.addEventListener("scroll", scheduleMarkerLayout, true);
  document.addEventListener("prototype-annotation:scopechange", () => scheduleContextRefresh(true));
  const handleHostMotion = event => {
    if (root.contains(event.target)) return;
    scheduleContextRefresh(true);
  };
  document.addEventListener("animationstart", handleHostMotion, true);
  document.addEventListener("animationend", handleHostMotion, true);
  document.addEventListener("animationcancel", handleHostMotion, true);
  document.addEventListener("transitionrun", handleHostMotion, true);
  document.addEventListener("transitionend", handleHostMotion, true);
  document.addEventListener("transitioncancel", handleHostMotion, true);
  window.addEventListener("resize", () => {
    clampLauncher();
    clampPanel();
    positionMenu();
    scheduleContextRefresh(true);
    scheduleReviewLayout();
    scheduleAnnotationAudit();
  });

  const scopeObserver = new MutationObserver(records => {
    if (records.every(record => (record.target === root || root.contains(record.target)) && !reviewPrototypeFrame.contains(record.target))) return;
    scheduleContextRefresh(true);
  });
  scopeObserver.observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "hidden", "style", "aria-hidden", "data-proto-scope", "data-proto-layer"]
  });

  function inspectCurrentScopeAnnotations() {
    const context = getScopeContext();
    const configured = getScopeNotes(context.scope);
    const invalidTargetIds = [];
    const hiddenTargetIds = [];
    const undersizedTargetIds = [];
    const clippedTargetIds = [];
    const points = [];
    configured.forEach(note => {
      const target = findTarget(note, context.node);
      if (!target) {
        invalidTargetIds.push(note.id);
        return;
      }
      if (!isElementRenderable(target, context.node)) {
        hiddenTargetIds.push(note.id);
        return;
      }
      if (isElementUndersized(target)) undersizedTargetIds.push(note.id);
      const clipped = getClippedTargetRect(target);
      if (!clipped) {
        clippedTargetIds.push(note.id);
        return;
      }
      const x = Math.min(1, Math.max(0, Number(note.x)));
      const y = Math.min(1, Math.max(0, Number(note.y)));
      points.push({
        id: note.id,
        x: Math.max(clipped.visible.left, Math.min(clipped.visible.right, clipped.original.left + clipped.original.width * x)),
        y: Math.max(clipped.visible.top, Math.min(clipped.visible.bottom, clipped.original.top + clipped.original.height * y))
      });
    });
    const overlaps = [];
    for (let index = 0; index < points.length; index += 1) {
      for (let next = index + 1; next < points.length; next += 1) {
        if (Math.hypot(points[index].x - points[next].x, points[index].y - points[next].y) < 28) {
          overlaps.push([points[index].id, points[next].id]);
        }
      }
    }
    return {
      scope: context.scope,
      configuredCount: configured.length,
      renderableCount: configured.length - invalidTargetIds.length - hiddenTargetIds.length,
      visibleMarkerCount: points.length,
      invalidTargetIds,
      hiddenTargetIds,
      undersizedTargetIds,
      clippedTargetIds,
      overlapPairs: overlaps,
      outOfViewportIds: points.filter(point => point.x < 0 || point.y < 0 || point.x > window.innerWidth || point.y > window.innerHeight).map(point => point.id)
    };
  }

  window.__prototypeWebDiagnostics = {
    inspect() {
      return {
        layerMode: root.dataset.protoWebLayerMode || "unknown",
        rootZIndex: getComputedStyle(root).zIndex,
        host: inspectHostLayers(),
        launcher: getLauncherHitAudit(),
        scope: getScopeContext().scope,
        annotationCount: getRenderableScopeNotes().length,
        annotationIds: getRenderableScopeNotes().map(note => note.id),
        annotationAudit: inspectCurrentScopeAnnotations(),
        review: {
          active: isReviewMode(),
          designWidth: reviewDesignWidth,
          designHeight: reviewDesignHeight,
          scale: Number(reviewPrototypeFrame.dataset.scale || 0),
          leftWidth: getReviewSideWidth("left"),
          rightWidth: getReviewSideWidth("right"),
          leftCollapsed: reviewWorkspace.classList.contains("is-left-collapsed"),
          rightCollapsed: reviewWorkspace.classList.contains("is-right-collapsed")
        }
      };
    },
    repair() {
      ensureAnnotationLayer(true);
      clampLauncher();
      scheduleMarkerLayout();
      scheduleAnnotationAudit();
    }
  };

  makeReviewSplitterDraggable(reviewLeftSplitter, "left");
  makeReviewSplitterDraggable(reviewRightSplitter, "right");
  if (window.ResizeObserver) new ResizeObserver(scheduleReviewLayout).observe(reviewCanvas);

  ensureAnnotationLayer(false);
  restorePreferences();
  requestAnimationFrame(() => {
    clampLauncher();
    renderMarkers();
    scheduleAnnotationAudit();
  });
})();
