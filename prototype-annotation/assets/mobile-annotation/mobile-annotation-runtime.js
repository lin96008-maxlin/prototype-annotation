(() => {
  const dataNode = document.getElementById("prototypeAnnotationData");
  const stage = document.getElementById("protoMobileStage");
  const device = document.getElementById("protoMobileDevice");
  const docsPanel = document.getElementById("protoMobileDocsPanel");
  const docsSplitter = document.getElementById("protoMobileDocsSplitter");
  const docNav = document.getElementById("protoMobileDocNav");
  const docContent = document.getElementById("protoMobileDocContent");
  const noteList = document.getElementById("protoMobileNoteList");
  const desktopToggle = document.getElementById("protoMobileDesktopToggle");
  const overlayRoot = document.getElementById("prototypeAnnotationRoot");
  const markerLayer = document.getElementById("protoMobileMarkerLayer");
  const compactTrigger = document.getElementById("protoMobileCompactDocsTrigger");
  const compactClose = document.getElementById("protoMobileCompactDocsClose");
  const compactBackdrop = document.getElementById("protoMobileCompactBackdrop");
  const mobileLauncher = document.getElementById("protoMobileMobileLauncher");
  const mobileCount = document.getElementById("protoMobileMobileCount");
  const mobileMenu = document.getElementById("protoMobileMobileMenu");
  const mobileMenuMeta = document.getElementById("protoMobileMobileMenuMeta");
  const mobileToggle = document.getElementById("protoMobileMobileToggle");
  const mobileDocsOpen = document.getElementById("protoMobileMobileDocsOpen");
  const mobileNoteLayer = document.getElementById("protoMobileMobileNoteLayer");
  const mobileSheet = document.getElementById("protoMobileMobileSheet");
  const mobileSheetHandle = document.getElementById("protoMobileMobileSheetHandle");
  const mobileSheetTitle = document.getElementById("protoMobileMobileSheetTitle");
  const mobileSheetBody = document.getElementById("protoMobileMobileSheetBody");
  const mobileDocsLayer = document.getElementById("protoMobileMobileDocsLayer");
  const mobileDocsContent = document.getElementById("protoMobileMobileDocsContent");

  if (!dataNode || !stage || !overlayRoot) return;

  let annotationData;
  try {
    annotationData = JSON.parse(dataNode.textContent);
  } catch (error) {
    console.error("移动端原型标注数据解析失败", error);
    return;
  }

  const annotations = Array.isArray(annotationData.annotations) ? annotationData.annotations : [];
  const globalSections = Array.isArray(annotationData.globalSections) ? annotationData.globalSections : [];
  const mobileConfig = annotationData.mobile || {};
  const appSelector = mobileConfig.appRoot || "[data-proto-app]";
  const approvedScrollSelectors = Array.isArray(mobileConfig.scrollContainers) && mobileConfig.scrollContainers.length
    ? mobileConfig.scrollContainers.filter(item => typeof item === "string" && item.trim())
    : ["[data-proto-scroll-container]", ".main-scroller"];
  const appRoot = document.querySelector(appSelector);
  if (!appRoot) {
    console.error(`移动端标注框架找不到业务根节点：${appSelector}`);
    return;
  }

  const deviceWidth = Math.min(480, Math.max(320, Number(mobileConfig.deviceWidth) || 414));
  document.documentElement.style.setProperty("--protoMobile-device-width", `${deviceWidth}px`);
  document.documentElement.classList.add("protoMobile-ready");
  document.body.appendChild(stage);
  document.body.appendChild(overlayRoot);
  device.appendChild(appRoot);
  stage.hidden = false;

  let currentScope = "";
  let currentNotes = [];
  let activeNoteId = "";
  let desktopEnabled = true;
  let mobileEnabled = false;
  let layoutFrame = 0;
  let contextRefreshFrame = 0;
  let contextRefreshUntil = 0;
  let mermaidCounter = 0;
  let sheetSnap = 1;
  let layerAuditTimer = 0;
  const sheetSnaps = [0.44, 0.68, 0.94];
  const rootMaxZIndex = 2147483646;
  const docsWidthStorageKey = `protoMobile:docs-width:${annotationData.prototypeId || "prototype"}`;
  const desktopDocsMinWidth = 320;
  const desktopDocsHardMaxWidth = 820;
  let lastLayoutIssueSignature = "";

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
        fontFamily: '-apple-system, BlinkMacSystemFont, "Microsoft YaHei", sans-serif',
        fontSize: "14px"
      }
    });
  }

  function isMobileViewport() {
    return window.matchMedia("(max-width: 767px)").matches;
  }

  function getDesktopDocsWidth() {
    return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--protoMobile-docs-width")) || 520;
  }

  function getDesktopDocsMaxWidth() {
    const reservedWidth = deviceWidth + 320 + 104;
    return Math.max(desktopDocsMinWidth, Math.min(desktopDocsHardMaxWidth, window.innerWidth - reservedWidth));
  }

  function setDesktopDocsWidth(requestedWidth, persist = false) {
    const maximum = getDesktopDocsMaxWidth();
    const width = Math.round(Math.min(maximum, Math.max(desktopDocsMinWidth, Number(requestedWidth) || 520)));
    document.documentElement.style.setProperty("--protoMobile-docs-width", `${width}px`);
    docsSplitter?.setAttribute("aria-valuemin", String(desktopDocsMinWidth));
    docsSplitter?.setAttribute("aria-valuemax", String(maximum));
    docsSplitter?.setAttribute("aria-valuenow", String(width));
    if (persist) {
      try { localStorage.setItem(docsWidthStorageKey, String(width)); } catch (error) {}
    }
    return width;
  }

  function restoreDesktopDocsWidth() {
    let stored = 0;
    try { stored = Number(localStorage.getItem(docsWidthStorageKey)); } catch (error) {}
    setDesktopDocsWidth(stored || 520, false);
  }

  function makeDesktopDocsResizable() {
    if (!docsSplitter) return;
    let dragState = null;
    docsSplitter.addEventListener("pointerdown", event => {
      if (event.button !== 0 || window.innerWidth < 1180) return;
      dragState = { pointerId: event.pointerId, startX: event.clientX, startWidth: getDesktopDocsWidth() };
      docsSplitter.setPointerCapture(event.pointerId);
      docsSplitter.classList.add("is-dragging");
      stage.classList.add("is-resizing");
      event.preventDefault();
    });
    docsSplitter.addEventListener("pointermove", event => {
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      setDesktopDocsWidth(dragState.startWidth + event.clientX - dragState.startX, false);
      scheduleMarkerLayout();
    });
    const endDrag = event => {
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      dragState = null;
      docsSplitter.classList.remove("is-dragging");
      stage.classList.remove("is-resizing");
      setDesktopDocsWidth(getDesktopDocsWidth(), true);
      scheduleMarkerLayout();
      requestAnimationFrame(() => auditLayout(true));
    };
    docsSplitter.addEventListener("pointerup", endDrag);
    docsSplitter.addEventListener("pointercancel", endDrag);
    docsSplitter.addEventListener("keydown", event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || window.innerWidth < 1180) return;
      const next = event.key === "Home"
        ? desktopDocsMinWidth
        : event.key === "End"
          ? getDesktopDocsMaxWidth()
          : getDesktopDocsWidth() + (event.key === "ArrowRight" ? 24 : -24);
      setDesktopDocsWidth(next, true);
      scheduleMarkerLayout();
      event.preventDefault();
    });
  }

  function isVisible(element) {
    if (!element) return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    if (element.hidden || element.getAttribute("aria-hidden") === "true") return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function serializeRect(rect) {
    return {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      right: Math.round(rect.right),
      bottom: Math.round(rect.bottom),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
  }

  function inspectLayout() {
    const issues = [];
    const stageRect = stage.getBoundingClientRect();
    const deviceRect = device.getBoundingClientRect();
    const docsRect = docsPanel.getBoundingClientRect();
    const notesPanel = noteList.closest(".protoMobile-notes-panel");
    const notesRect = notesPanel?.getBoundingClientRect() || new DOMRect();
    const desktopWide = window.innerWidth >= 1180;
    if (stage.parentElement !== document.body) issues.push("STAGE_NOT_MOUNTED_TO_BODY");
    if (Math.abs(stageRect.left) > 2 || Math.abs(stageRect.top) > 2
      || Math.abs(stageRect.width - window.innerWidth) > 3
      || Math.abs(stageRect.height - window.innerHeight) > 3) issues.push("STAGE_NOT_VIEWPORT_SIZED");
    if (desktopWide) {
      const hasDocs = globalSections.length > 0;
      if ((hasDocs && !isVisible(docsPanel)) || !isVisible(device) || !isVisible(notesPanel)) issues.push("DESKTOP_COLUMNS_MISSING");
      if (Math.abs(deviceRect.width - deviceWidth) > 3) issues.push("DEVICE_WIDTH_INVALID");
      if ((hasDocs && docsRect.right > deviceRect.left + 1) || deviceRect.right > notesRect.left + 1) issues.push("DESKTOP_COLUMNS_OVERLAP");
      if (hasDocs && (docsRect.width < desktopDocsMinWidth - 2 || docsRect.width > getDesktopDocsMaxWidth() + 2)) issues.push("DOCS_WIDTH_OUT_OF_RANGE");
    } else if (isMobileViewport()) {
      if (Math.abs(deviceRect.width - window.innerWidth) > 3) issues.push("MOBILE_DEVICE_NOT_VIEWPORT_SIZED");
    }
    const markerOutsideDeviceIds = Array.from(markerLayer.querySelectorAll(".protoMobile-marker:not([hidden])"))
      .filter(marker => getComputedStyle(marker).display !== "none")
      .filter(marker => {
        const rect = marker.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        return x < deviceRect.left - 2 || x > deviceRect.right + 2 || y < deviceRect.top - 2 || y > deviceRect.bottom + 2;
      })
      .map(marker => marker.dataset.noteId);
    if (markerOutsideDeviceIds.length) issues.push("MARKERS_OUTSIDE_DEVICE");
    return {
      status: issues.length ? "fail" : "pass",
      issues,
      stageMountedToBody: stage.parentElement === document.body,
      docsWidthMaximum: getDesktopDocsMaxWidth(),
      markerOutsideDeviceIds,
      rects: {
        stage: serializeRect(stageRect),
        docs: serializeRect(docsRect),
        device: serializeRect(deviceRect),
        notes: serializeRect(notesRect)
      }
    };
  }

  function auditLayout(logFailure = false) {
    const report = inspectLayout();
    stage.dataset.protoMobileLayoutStatus = report.status;
    const signature = report.issues.join("|");
    if (logFailure && report.status === "fail" && signature !== lastLayoutIssueSignature) {
      console.error("移动端标注审阅框架布局检查未通过", report);
    }
    lastLayoutIssueSignature = signature;
    return report;
  }

  function isTargetRenderable(target, scopeNode) {
    if (!target || !target.isConnected) return false;
    let current = target;
    while (current && current.nodeType === 1) {
      const style = getComputedStyle(current);
      if (current.hidden || current.getAttribute("aria-hidden") === "true") return false;
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
      if (current === scopeNode || current === appRoot) break;
      current = current.parentElement;
    }
    const rect = target.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isTargetUndersized(target) {
    const rect = target.getBoundingClientRect();
    return rect.width < 4 || rect.height < 4;
  }

  function isPopoverOpen() {
    try {
      return overlayRoot.matches(":popover-open");
    } catch (error) {
      return false;
    }
  }

  function ensureOverlayLayer(reorder = false) {
    if (typeof overlayRoot.showPopover === "function" && typeof overlayRoot.hidePopover === "function") {
      try {
        if (reorder && isPopoverOpen()) overlayRoot.hidePopover();
        if (!isPopoverOpen()) overlayRoot.showPopover();
        overlayRoot.dataset.protoMobileLayerMode = "top-layer";
        overlayRoot.style.zIndex = String(rootMaxZIndex);
        return;
      } catch (error) {
        console.warn("移动端标注层进入 top layer 失败，已使用 z-index 兜底", error);
      }
    }
    overlayRoot.removeAttribute("popover");
    overlayRoot.style.zIndex = String(rootMaxZIndex);
    overlayRoot.dataset.protoMobileLayerMode = "z-index";
  }

  function scheduleLayerAudit() {
    window.clearTimeout(layerAuditTimer);
    layerAuditTimer = window.setTimeout(() => {
      ensureOverlayLayer(false);
      if (!isMobileViewport()) return;
      const rect = mobileLauncher.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      const clickable = Boolean(hit && (hit === mobileLauncher || mobileLauncher.contains(hit)));
      overlayRoot.dataset.protoMobileLauncherClickable = String(clickable);
      if (!clickable) {
        ensureOverlayLayer(true);
        requestAnimationFrame(() => {
          const nextHit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          if (!(nextHit && (nextHit === mobileLauncher || mobileLauncher.contains(nextHit)))) {
            console.error("移动端原型标注入口被业务界面遮挡");
          }
        });
      }
    }, 40);
  }

  function getScopeContext() {
    const candidates = Array.from(appRoot.querySelectorAll("[data-proto-scope]"));
    if (appRoot.matches("[data-proto-scope]")) candidates.unshift(appRoot);
    const visible = candidates
      .map((node, index) => ({ node, index, scope: node.dataset.protoScope, layer: Number(node.dataset.protoLayer) || 0 }))
      .filter(item => item.scope && isVisible(item.node));
    if (visible.length) {
      visible.sort((a, b) => a.layer - b.layer || a.index - b.index);
      return visible[visible.length - 1];
    }
    return { node: appRoot, scope: appRoot.dataset.protoScope || "page:default", layer: 0 };
  }

  function notesForScope(scope) {
    const acceptedScopes = new Set([scope]);
    if (scope.startsWith("page:")) {
      const parts = scope.split(":");
      if (parts.length >= 3) acceptedScopes.add(`${parts.slice(0, 2).join(":")}:*`);
      acceptedScopes.add("page:*");
    }
    return annotations.filter(note => acceptedScopes.has(note.scope));
  }

  function findTarget(note, scopeNode = getScopeContext().node) {
    try {
      if (scopeNode?.matches?.(note.target)) return scopeNode;
      return scopeNode?.querySelector?.(note.target) || appRoot.querySelector(note.target);
    } catch (error) {
      console.warn(`移动端标注 ${note.id || note.title || "未命名"} 的 target 无效`, error);
      return null;
    }
  }

  function resolveNotesForContext(context) {
    return notesForScope(context.scope).filter(note => {
      const target = findTarget(note, context.node);
      return isTargetRenderable(target, context.node);
    });
  }

  function getClippedTargetRect(target) {
    if (!isVisible(target)) return null;
    const original = target.getBoundingClientRect();
    const deviceRect = device.getBoundingClientRect();
    let left = Math.max(original.left, deviceRect.left);
    let top = Math.max(original.top, deviceRect.top);
    let right = Math.min(original.right, deviceRect.right);
    let bottom = Math.min(original.bottom, deviceRect.bottom);
    let parent = target.parentElement;
    while (parent && parent !== appRoot.parentElement) {
      const style = getComputedStyle(parent);
      if (/(auto|scroll|hidden|clip)/.test(`${style.overflow}${style.overflowX}${style.overflowY}`)) {
        const rect = parent.getBoundingClientRect();
        left = Math.max(left, rect.left);
        top = Math.max(top, rect.top);
        right = Math.min(right, rect.right);
        bottom = Math.min(bottom, rect.bottom);
      }
      if (parent === appRoot) break;
      parent = parent.parentElement;
    }
    if (right <= left || bottom <= top) return null;
    return { original, visible: { left, top, right, bottom } };
  }

  function setActive(noteId) {
    activeNoteId = noteId;
    document.querySelectorAll(".protoMobile-marker, .protoMobile-note-card").forEach(element => {
      element.classList.toggle("is-active", element.dataset.noteId === noteId);
    });
  }

  function scheduleMarkerLayout() {
    if (layoutFrame) return;
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = 0;
      positionMarkers();
    });
  }

  function positionMarkers() {
    const deviceRect = device.getBoundingClientRect();
    const occupied = [];
    markerLayer.querySelectorAll(".protoMobile-marker").forEach(marker => {
      const note = currentNotes.find(item => item.id === marker.dataset.noteId);
      const target = note ? findTarget(note) : null;
      const clipped = target ? getClippedTargetRect(target) : null;
      if (!note || !clipped) {
        marker.hidden = true;
        return;
      }
      const anchorX = Number.isFinite(Number(note.x)) ? Math.min(1, Math.max(0, Number(note.x))) : 0.5;
      const anchorY = Number.isFinite(Number(note.y)) ? Math.min(1, Math.max(0, Number(note.y))) : 0.5;
      let left = clipped.original.left + clipped.original.width * anchorX;
      let top = clipped.original.top + clipped.original.height * anchorY;
      left = Math.max(clipped.visible.left, Math.min(clipped.visible.right, left));
      top = Math.max(clipped.visible.top, Math.min(clipped.visible.bottom, top));
      left = Math.max(deviceRect.left + 18, Math.min(deviceRect.right - 18, left));
      top = Math.max(deviceRect.top + 18, Math.min(deviceRect.bottom - 18, top));
      for (let attempt = 0; attempt < 5; attempt += 1) {
        if (!occupied.some(point => Math.hypot(point.left - left, point.top - top) < 36)) break;
        top = Math.min(deviceRect.bottom - 18, top + 36);
      }
      occupied.push({ left, top });
      marker.hidden = false;
      marker.style.left = `${left}px`;
      marker.style.top = `${top}px`;
    });
  }

  function renderMarkers() {
    markerLayer.replaceChildren();
    const shouldHide = isMobileViewport() ? !mobileEnabled : !desktopEnabled;
    const docsOpen = mobileDocsLayer.classList.contains("is-open") || docsPanel.classList.contains("is-compact-open");
    markerLayer.classList.toggle("is-hidden", shouldHide || docsOpen);
    currentNotes.forEach((note, index) => {
      const marker = document.createElement("button");
      marker.type = "button";
      marker.className = "protoMobile-marker";
      marker.dataset.noteId = note.id;
      marker.textContent = String(index + 1);
      marker.title = note.title;
      marker.setAttribute("aria-label", `标注 ${index + 1}：${note.title}`);
      marker.addEventListener("click", event => {
        event.stopPropagation();
        openNote(note);
      });
      markerLayer.appendChild(marker);
    });
    setActive(activeNoteId);
    scheduleMarkerLayout();
  }

  async function renderMermaidBlocks(root) {
    if (!window.mermaid) return;
    const blocks = Array.from(root.querySelectorAll("pre code.language-mermaid"));
    for (const block of blocks) {
      const pre = block.closest("pre");
      const container = document.createElement("div");
      container.className = "protoMobile-mermaid";
      try {
        const result = await window.mermaid.render(`protoMobile-mermaid-${++mermaidCounter}`, block.textContent.trim());
        container.innerHTML = result.svg;
        if (result.bindFunctions) result.bindFunctions(container);
        pre.replaceWith(container);
      } catch (error) {
        pre.classList.add("protoMobile-mermaid-error");
        console.error("移动端标注流程图渲染失败", error);
      }
    }
  }

  async function renderRichContent(root, item) {
    if (item.format === "html" || !window.marked) root.innerHTML = item.content || "";
    else root.innerHTML = window.marked.parse(item.content || "", { gfm: true, breaks: true });
    await renderMermaidBlocks(root);
  }

  function renderNoteList() {
    noteList.replaceChildren();
    if (!currentNotes.length) {
      noteList.innerHTML = '<div class="protoMobile-empty">当前页面暂无标注</div>';
      return;
    }
    currentNotes.forEach((note, index) => {
      const card = document.createElement("article");
      card.className = "protoMobile-note-card";
      card.dataset.noteId = note.id;
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", `定位标注 ${index + 1}：${note.title}`);
      const number = document.createElement("span");
      number.className = "protoMobile-note-index";
      number.textContent = String(index + 1);
      const copy = document.createElement("div");
      copy.className = "protoMobile-rich-content";
      const heading = document.createElement("h3");
      heading.textContent = note.title;
      const body = document.createElement("div");
      copy.append(heading, body);
      card.append(number, copy);
      const locate = () => locateTarget(note);
      card.addEventListener("click", locate);
      card.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          locate();
        }
      });
      noteList.appendChild(card);
      renderRichContent(body, note).catch(error => console.error("移动端标注列表渲染失败", error));
    });
    setActive(activeNoteId);
  }

  function highlightTarget(target) {
    document.querySelectorAll(".protoMobile-target-highlight").forEach(element => element.classList.remove("protoMobile-target-highlight"));
    target.classList.add("protoMobile-target-highlight");
    window.setTimeout(() => target.classList.remove("protoMobile-target-highlight"), 1100);
  }

  function matchesApprovedScrollContainer(element) {
    return approvedScrollSelectors.some(selector => {
      try {
        return element.matches(selector);
      } catch (error) {
        console.warn(`移动端标注滚动容器选择器无效：${selector}`, error);
        return false;
      }
    });
  }

  function findScrollParent(target) {
    let parent = target.parentElement;
    while (parent && parent !== document.body && parent !== device && parent !== stage) {
      const style = getComputedStyle(parent);
      if (matchesApprovedScrollContainer(parent)
        && /(auto|scroll)/.test(style.overflowY)
        && parent.scrollHeight > parent.clientHeight + 1) return parent;
      if (parent === appRoot) break;
      parent = parent.parentElement;
    }
    return null;
  }

  function isFullyVisibleInDevice(target, scroller = null) {
    const targetRect = target.getBoundingClientRect();
    const deviceRect = device.getBoundingClientRect();
    const scrollRect = scroller ? scroller.getBoundingClientRect() : deviceRect;
    const viewport = {
      left: Math.max(deviceRect.left, scrollRect.left),
      top: Math.max(deviceRect.top, scrollRect.top),
      right: Math.min(deviceRect.right, scrollRect.right),
      bottom: Math.min(deviceRect.bottom, scrollRect.bottom)
    };
    return targetRect.left >= viewport.left - 1
      && targetRect.top >= viewport.top - 1
      && targetRect.right <= viewport.right + 1
      && targetRect.bottom <= viewport.bottom + 1;
  }

  function trackScrollUntilSettled(scroller, target) {
    let last = scroller.scrollTop;
    let stableFrames = 0;
    let frameCount = 0;
    function track() {
      scheduleMarkerLayout();
      const current = scroller.scrollTop;
      stableFrames = Math.abs(current - last) < 0.5 ? stableFrames + 1 : 0;
      last = current;
      frameCount += 1;
      if (stableFrames >= 3 || frameCount > 90) {
        highlightTarget(target);
        scheduleMarkerLayout();
        return;
      }
      requestAnimationFrame(track);
    }
    requestAnimationFrame(track);
  }

  function locateTarget(note) {
    const target = findTarget(note);
    if (!target) return;
    setActive(note.id);
    if (note.scroll === false || target.closest('[data-proto-scroll="none"]')) {
      highlightTarget(target);
      scheduleMarkerLayout();
      return;
    }
    const scroller = findScrollParent(target);
    if (!scroller || isFullyVisibleInDevice(target, scroller)) {
      highlightTarget(target);
      scheduleMarkerLayout();
      return;
    }
    const scrollRect = scroller.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const targetTop = targetRect.top - scrollRect.top + scroller.scrollTop;
    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const desiredTop = Math.min(maxScrollTop, Math.max(0, targetTop - (scroller.clientHeight - targetRect.height) / 2));
    if (Math.abs(desiredTop - scroller.scrollTop) < 0.5) {
      highlightTarget(target);
      scheduleMarkerLayout();
      return;
    }
    scroller.scrollTo({ top: desiredTop, behavior: "smooth" });
    trackScrollUntilSettled(scroller, target);
  }

  async function openNote(note) {
    setActive(note.id);
    if (!isMobileViewport()) {
      const card = noteList.querySelector(`[data-note-id="${CSS.escape(note.id)}"]`);
      if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        card.focus({ preventScroll: true });
      }
      return;
    }
    mobileSheetTitle.textContent = note.title;
    await renderRichContent(mobileSheetBody, note);
    mobileNoteLayer.classList.add("is-open");
    mobileNoteLayer.setAttribute("aria-hidden", "false");
    closeMobileMenu();
    applySheetSnap();
  }

  function closeMobileNote() {
    mobileNoteLayer.classList.remove("is-open");
    mobileNoteLayer.setAttribute("aria-hidden", "true");
  }

  function applySheetSnap() {
    mobileSheet.style.setProperty("--protoMobile-sheet-height", `${Math.round(sheetSnaps[sheetSnap] * 100)}dvh`);
  }

  async function renderGlobalDocs() {
    docNav.replaceChildren();
    docContent.replaceChildren();
    if (!globalSections.length) {
      stage.classList.add("no-docs");
      mobileDocsOpen.hidden = true;
      docsPanel.hidden = true;
      return;
    }
    for (const [index, section] of globalSections.entries()) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = section.title;
      button.classList.toggle("is-active", index === 0);
      const sectionNode = document.createElement("section");
      sectionNode.className = "protoMobile-doc-section";
      sectionNode.id = `protoMobile-doc-${section.id}`;
      const heading = document.createElement("h3");
      heading.textContent = section.title;
      const body = document.createElement("div");
      body.className = "protoMobile-rich-content";
      sectionNode.append(heading, body);
      docNav.appendChild(button);
      docContent.appendChild(sectionNode);
      await renderRichContent(body, section);
      button.addEventListener("click", () => {
        docNav.querySelectorAll("button").forEach(item => item.classList.toggle("is-active", item === button));
        const contentRect = docContent.getBoundingClientRect();
        const targetRect = sectionNode.getBoundingClientRect();
        docContent.scrollTo({ top: targetRect.top - contentRect.top + docContent.scrollTop, behavior: "smooth" });
      });
    }
  }

  function openMobileDocs() {
    if (!globalSections.length) return;
    closeMobileMenu();
    closeMobileNote();
    mobileDocsContent.innerHTML = docContent.innerHTML;
    mobileDocsContent.querySelectorAll("[id]").forEach(element => element.removeAttribute("id"));
    mobileDocsLayer.classList.add("is-open");
    mobileDocsLayer.setAttribute("aria-hidden", "false");
    markerLayer.classList.add("is-hidden");
  }

  function closeMobileDocs() {
    mobileDocsLayer.classList.remove("is-open");
    mobileDocsLayer.setAttribute("aria-hidden", "true");
    renderMarkers();
  }

  function syncContext() {
    ensureOverlayLayer(true);
    const context = getScopeContext();
    const nextNotes = resolveNotesForContext(context);
    const scopeChanged = context.scope !== currentScope;
    const notesChanged = nextNotes.length !== currentNotes.length
      || nextNotes.some((note, index) => note.id !== currentNotes[index]?.id);
    if (scopeChanged || notesChanged) {
      currentScope = context.scope;
      currentNotes = nextNotes;
      if (!currentNotes.some(note => note.id === activeNoteId)) activeNoteId = "";
      closeMobileNote();
      renderNoteList();
      renderMarkers();
    } else {
      setActive(activeNoteId);
      scheduleMarkerLayout();
    }
    mobileCount.textContent = String(currentNotes.length);
    mobileMenuMeta.textContent = `当前页面 ${currentNotes.length} 条`;
    scheduleLayerAudit();
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

  function positionMobileMenu() {
    if (!mobileMenu.classList.contains("is-open")) return;
    const launcherRect = mobileLauncher.getBoundingClientRect();
    const menuRect = mobileMenu.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(Math.max(margin, launcherRect.right - menuRect.width), window.innerWidth - menuRect.width - margin);
    let top = launcherRect.top - menuRect.height - 10;
    if (top < margin) top = launcherRect.bottom + 10;
    mobileMenu.style.left = `${left}px`;
    mobileMenu.style.top = `${Math.min(top, window.innerHeight - menuRect.height - margin)}px`;
  }

  function closeMobileMenu() {
    mobileMenu.classList.remove("is-open");
    mobileLauncher.setAttribute("aria-expanded", "false");
  }

  function toggleMobileMenu() {
    const willOpen = !mobileMenu.classList.contains("is-open");
    mobileMenu.classList.toggle("is-open", willOpen);
    mobileLauncher.setAttribute("aria-expanded", String(willOpen));
    if (willOpen) positionMobileMenu();
  }

  function inspectCompactDocsLayer() {
    const open = docsPanel.classList.contains("is-compact-open");
    if (!open) return { status: "closed", open: false };
    const rect = docsPanel.getBoundingClientRect();
    const sampleX = Math.max(rect.left + 1, Math.min(rect.right - 1, rect.left + Math.min(80, rect.width / 2)));
    const sampleY = Math.max(rect.top + 1, Math.min(rect.bottom - 1, rect.top + Math.min(32, rect.height / 2)));
    const hit = document.elementFromPoint(sampleX, sampleY);
    const issues = [];
    if (docsPanel.parentElement !== overlayRoot) issues.push("DOCS_NOT_IN_OVERLAY_ROOT");
    if (!compactBackdrop.classList.contains("is-open")) issues.push("COMPACT_BACKDROP_NOT_OPEN");
    if (!isVisible(docsPanel)) issues.push("COMPACT_DOCS_NOT_VISIBLE");
    if (!(hit && (hit === docsPanel || docsPanel.contains(hit)))) issues.push("COMPACT_DOCS_NOT_CLICKABLE");
    if (!markerLayer.classList.contains("is-hidden")) issues.push("MARKERS_VISIBLE_BEHIND_DOCS");
    return {
      status: issues.length ? "fail" : "pass",
      open: true,
      issues,
      mountedToOverlayRoot: docsPanel.parentElement === overlayRoot,
      markersHidden: markerLayer.classList.contains("is-hidden"),
      hitInsidePanel: Boolean(hit && (hit === docsPanel || docsPanel.contains(hit))),
      rect: serializeRect(rect)
    };
  }

  function auditCompactDocsLayer(logFailure = false) {
    const report = inspectCompactDocsLayer();
    docsPanel.dataset.protoMobileLayerStatus = report.status;
    if (logFailure && report.status === "fail") console.error("移动端中宽原型说明层级检查未通过", report);
    return report;
  }

  function restoreCompactDocsToStage() {
    if (docsPanel.parentElement !== stage) stage.insertBefore(docsPanel, docsSplitter || device);
  }

  function openCompactDocs() {
    if (isMobileViewport() || window.innerWidth >= 1180) return;
    ensureOverlayLayer(false);
    overlayRoot.appendChild(docsPanel);
    compactBackdrop.classList.add("is-open");
    docsPanel.classList.add("is-compact-open");
    renderMarkers();
    requestAnimationFrame(() => auditCompactDocsLayer(true));
  }

  function closeCompactDocs() {
    const wasOpen = docsPanel.classList.contains("is-compact-open");
    docsPanel.classList.remove("is-compact-open");
    compactBackdrop.classList.remove("is-open");
    restoreCompactDocsToStage();
    docsPanel.dataset.protoMobileLayerStatus = "closed";
    if (wasOpen) renderMarkers();
  }

  desktopToggle.addEventListener("click", () => {
    desktopEnabled = !desktopEnabled;
    desktopToggle.setAttribute("aria-checked", String(desktopEnabled));
    desktopToggle.setAttribute("aria-label", desktopEnabled ? "隐藏页面标注" : "显示页面标注");
    renderMarkers();
  });

  compactTrigger.addEventListener("click", openCompactDocs);
  compactClose.addEventListener("click", closeCompactDocs);
  compactBackdrop.addEventListener("click", closeCompactDocs);

  let launcherDrag = null;
  let suppressLauncherClick = false;
  mobileLauncher.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    const rect = mobileLauncher.getBoundingClientRect();
    launcherDrag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top, moved: false };
    mobileLauncher.style.left = `${rect.left}px`;
    mobileLauncher.style.top = `${rect.top}px`;
    mobileLauncher.style.right = "auto";
    mobileLauncher.style.bottom = "auto";
    mobileLauncher.setPointerCapture(event.pointerId);
  });
  mobileLauncher.addEventListener("pointermove", event => {
    if (!launcherDrag || event.pointerId !== launcherDrag.pointerId) return;
    const dx = event.clientX - launcherDrag.startX;
    const dy = event.clientY - launcherDrag.startY;
    if (Math.hypot(dx, dy) > 5) launcherDrag.moved = true;
    if (!launcherDrag.moved) return;
    mobileLauncher.style.left = `${Math.max(8, Math.min(window.innerWidth - 60, launcherDrag.left + dx))}px`;
    mobileLauncher.style.top = `${Math.max(8, Math.min(window.innerHeight - 60, launcherDrag.top + dy))}px`;
    closeMobileMenu();
  });
  mobileLauncher.addEventListener("pointerup", event => {
    if (!launcherDrag || event.pointerId !== launcherDrag.pointerId) return;
    suppressLauncherClick = launcherDrag.moved;
    launcherDrag = null;
  });
  mobileLauncher.addEventListener("click", event => {
    if (suppressLauncherClick) {
      suppressLauncherClick = false;
      event.preventDefault();
      return;
    }
    toggleMobileMenu();
  });

  mobileToggle.addEventListener("click", event => {
    event.stopPropagation();
    mobileEnabled = !mobileEnabled;
    mobileToggle.setAttribute("aria-checked", String(mobileEnabled));
    mobileToggle.setAttribute("aria-label", mobileEnabled ? "隐藏页面标注" : "显示页面标注");
    renderMarkers();
  });
  mobileDocsOpen.addEventListener("click", openMobileDocs);
  document.getElementById("protoMobileMobileDocsClose").addEventListener("click", closeMobileDocs);
  document.getElementById("protoMobileMobileNoteClose").addEventListener("click", closeMobileNote);
  document.getElementById("protoMobileMobileNoteMask").addEventListener("click", closeMobileNote);
  document.getElementById("protoMobileMobileSheetSize").addEventListener("click", () => {
    sheetSnap = (sheetSnap + 1) % sheetSnaps.length;
    applySheetSnap();
  });

  let sheetDrag = null;
  mobileSheetHandle.addEventListener("pointerdown", event => {
    sheetDrag = { pointerId: event.pointerId, startY: event.clientY, startHeight: mobileSheet.getBoundingClientRect().height };
    mobileSheetHandle.setPointerCapture(event.pointerId);
  });
  mobileSheetHandle.addEventListener("pointermove", event => {
    if (!sheetDrag || event.pointerId !== sheetDrag.pointerId) return;
    const height = Math.max(window.innerHeight * 0.36, Math.min(window.innerHeight * 0.94, sheetDrag.startHeight + sheetDrag.startY - event.clientY));
    mobileSheet.style.setProperty("--protoMobile-sheet-height", `${height}px`);
  });
  mobileSheetHandle.addEventListener("pointerup", event => {
    if (!sheetDrag || event.pointerId !== sheetDrag.pointerId) return;
    const ratio = mobileSheet.getBoundingClientRect().height / window.innerHeight;
    sheetSnap = sheetSnaps.reduce((best, value, index) => Math.abs(value - ratio) < Math.abs(sheetSnaps[best] - ratio) ? index : best, 0);
    sheetDrag = null;
    applySheetSnap();
  });

  document.addEventListener("click", event => {
    if (!mobileMenu.contains(event.target) && !mobileLauncher.contains(event.target)) closeMobileMenu();
  });
  document.addEventListener("scroll", scheduleMarkerLayout, true);
  document.addEventListener("prototype-annotation:scopechange", () => scheduleContextRefresh(true));
  document.addEventListener("animationstart", () => scheduleContextRefresh(true), true);
  document.addEventListener("animationend", () => scheduleContextRefresh(true), true);
  document.addEventListener("animationcancel", () => scheduleContextRefresh(true), true);
  document.addEventListener("transitionrun", () => scheduleContextRefresh(true), true);
  document.addEventListener("transitionend", () => scheduleContextRefresh(true), true);
  document.addEventListener("transitioncancel", () => scheduleContextRefresh(true), true);
  window.addEventListener("resize", () => {
    closeCompactDocs();
    closeMobileMenu();
    closeMobileNote();
    setDesktopDocsWidth(getDesktopDocsWidth(), false);
    applySheetSnap();
    scheduleContextRefresh(true);
    requestAnimationFrame(() => auditLayout(true));
  });

  const scopeObserver = new MutationObserver(() => scheduleContextRefresh(true));
  scopeObserver.observe(appRoot, {
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "hidden", "style", "aria-hidden", "aria-selected", "data-proto-scope", "data-proto-layer"]
  });
  if (window.ResizeObserver) {
    const resizeObserver = new ResizeObserver(() => scheduleContextRefresh(true));
    resizeObserver.observe(device);
    resizeObserver.observe(appRoot);
    resizeObserver.observe(stage);
  }

  function inspectCurrentScopeAnnotations() {
    const context = getScopeContext();
    const configured = notesForScope(context.scope);
    const invalidTargetIds = [];
    const hiddenTargetIds = [];
    const undersizedTargetIds = [];
    configured.forEach(note => {
      const target = findTarget(note, context.node);
      if (!target) invalidTargetIds.push(note.id);
      else if (!isTargetRenderable(target, context.node)) hiddenTargetIds.push(note.id);
      else if (isTargetUndersized(target)) undersizedTargetIds.push(note.id);
    });
    return {
      scope: context.scope,
      configuredCount: configured.length,
      listCount: currentNotes.length,
      markerNodeCount: markerLayer.querySelectorAll(".protoMobile-marker").length,
      invalidTargetIds,
      hiddenTargetIds,
      undersizedTargetIds,
      currentIds: currentNotes.map(note => note.id)
    };
  }

  window.__prototypeMobileDiagnostics = {
    inspect() {
      const rect = mobileLauncher.getBoundingClientRect();
      const hit = isMobileViewport() ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) : null;
      return {
        viewportMode: isMobileViewport() ? "mobile" : "desktop",
        layerMode: overlayRoot.dataset.protoMobileLayerMode || "unknown",
        scope: getScopeContext().scope,
        annotationCount: currentNotes.length,
        annotationIds: currentNotes.map(note => note.id),
        deviceScrollTop: device.scrollTop,
        stageScrollTop: stage.scrollTop,
        windowScrollY: window.scrollY,
        annotationAudit: inspectCurrentScopeAnnotations(),
        layoutAudit: auditLayout(false),
        compactDocsAudit: inspectCompactDocsLayer(),
        launcherClickable: !isMobileViewport() || Boolean(hit && (hit === mobileLauncher || mobileLauncher.contains(hit)))
      };
    },
    repair() {
      ensureOverlayLayer(true);
      if (docsPanel.classList.contains("is-compact-open")) overlayRoot.appendChild(docsPanel);
      syncContext();
      requestAnimationFrame(() => auditCompactDocsLayer(true));
    }
  };

  restoreDesktopDocsWidth();
  makeDesktopDocsResizable();
  ensureOverlayLayer(false);
  renderGlobalDocs()
    .then(() => {
      syncContext();
      requestAnimationFrame(() => requestAnimationFrame(() => auditLayout(true)));
    })
    .catch(error => {
      console.error("移动端原型说明渲染失败", error);
      syncContext();
    });
  applySheetSnap();
})();
