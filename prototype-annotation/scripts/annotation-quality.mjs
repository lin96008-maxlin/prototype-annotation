const GENERIC_TARGETS = new Set([
  "body", "main", "section", "article", ".app", ".page", ".mobile-page",
  ".page-panel", ".page-panel-header", ".page-panel-body", ".content",
  ".main-content", ".right-panel", "[data-proto-scope]"
]);

function normalizeSelector(selector) {
  return String(selector || "").trim().replace(/\s+/g, " ");
}

function normalizeText(value) {
  return String(value || "").replace(/```[\s\S]*?```/g, "").replace(/\s+/g, " ").trim();
}

function ratio(count, total) {
  return total ? Number((count / total).toFixed(4)) : 0;
}

function groupBy(items, keyOf) {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function scopeIsValid(scope, platform) {
  if (scope === "page:*") return true;
  if (platform === "mobile") {
    return /^(?:page:[a-z0-9][a-z0-9_-]*(?::(?:\*|[a-z0-9][a-z0-9_-]*))?|sheet:[a-z0-9][a-z0-9_-]*|dialog:[a-z0-9][a-z0-9_-]*)$/i.test(scope);
  }
  return /^(?:page:[a-z0-9][a-z0-9_-]*|drawer:[a-z0-9][a-z0-9_-]*|modal:[a-z0-9][a-z0-9_-]*)$/i.test(scope);
}

const BUSINESS_LOGIC_PATTERN = /权限|角色|仅限|必须|不可|禁止|条件|状态|校验|必填|默认值|计算|口径|来源|范围|联动|审批|流程|业务规则|异常|失败|空状态|缺省|期限|超时|去重|映射|继承|只读|脱敏|影响|前置|后置|保留|保持|恢复|刷新频率|更新频率|跨页签|跨页面/u;
const OBVIOUS_UI_PATTERN = /导航栏|顶部导航|底部导航|页面导航|页面标题|返回按钮|面包屑|Navbar|Tabbar|用于切换页面|用于切换页签|显示当前页面|展示当前页面/u;
const GENERIC_NAVIGATION_PATTERN = /(?:支持|点击|可|用于).{0,12}(?:下钻|进入详情|查看详情|跳转(?:至|到)?(?:详情|下级)|返回上一页)/u;
const GENERIC_CAPABILITY_PATTERN = /(?:支持|可以|可进行|点击).{0,12}(?:搜索|查询|筛选|重置|刷新|分页|导入|导出|新增|编辑|删除|提交|撤回|启用|停用)/u;
const VISUAL_DESCRIPTION_PATTERN = /采用(?:卡片|列表|表格|左右分栏)|以(?:卡片|列表|表格)形式展示|页面分为.{0,12}(?:区域|部分)|左侧.{0,18}右侧/u;
const NAVIGATION_TARGET_PATTERN = /(?:^|[.#\s_-])(?:nav|navbar|tabbar|breadcrumb|page-title|back-button|top-nav|bottom-nav)(?:$|[.#\s_:[-])/i;

function isLowValueAnnotation(note) {
  const text = normalizeText(`${note.title}\n${note.content}`);
  const target = normalizeSelector(note.target);
  const describesObviousUi = OBVIOUS_UI_PATTERN.test(text) || NAVIGATION_TARGET_PATTERN.test(target);
  const genericNavigation = GENERIC_NAVIGATION_PATTERN.test(text);
  const genericCapability = GENERIC_CAPABILITY_PATTERN.test(text);
  const visualDescription = VISUAL_DESCRIPTION_PATTERN.test(text);
  return (describesObviousUi || genericNavigation || genericCapability || visualDescription) && !BUSINESS_LOGIC_PATTERN.test(text);
}

export function analyzeAnnotationQuality(data, { platform = "web" } = {}) {
  const notes = data.annotations;
  const total = notes.length;
  const issues = [];
  const genericNotes = notes.filter(note => GENERIC_TARGETS.has(normalizeSelector(note.target).toLowerCase()));
  const unstableTargetIds = notes
    .filter(note => /:nth-(?:child|of-type)\s*\(/i.test(note.target))
    .map(note => note.id);
  const invalidScopeIds = notes.filter(note => !scopeIsValid(note.scope, platform)).map(note => note.id);
  const lowValueAnnotationIds = notes.filter(isLowValueAnnotation).map(note => note.id);
  const signatureGroups = groupBy(notes, note => `${normalizeSelector(note.target)}|${Number(note.x).toFixed(3)}|${Number(note.y).toFixed(3)}`);
  const repeatedSignatureIds = new Set();
  const repeatedSignatures = [];
  for (const [signature, group] of signatureGroups) {
    const scopes = new Set(group.map(note => note.scope));
    if (group.length >= 3 && scopes.size >= 3) {
      group.forEach(note => repeatedSignatureIds.add(note.id));
      repeatedSignatures.push({ signature, count: group.length, scopes: scopes.size });
    }
  }

  const contentGroups = groupBy(notes, note => normalizeText(`${note.title}\n${note.content}`));
  const repeatedContentIds = new Set();
  for (const [content, group] of contentGroups) {
    const scopes = new Set(group.map(note => note.scope));
    if (content && group.length >= 3 && scopes.size >= 3) group.forEach(note => repeatedContentIds.add(note.id));
  }

  const textEntries = [
    ...notes.map(note => ({ id: note.id, text: `${note.title}\n${note.content}` })),
    ...data.globalSections.map(section => ({ id: `global:${section.id}`, text: `${section.title}\n${section.content}` }))
  ];
  const suspiciousText = textEntries.filter(entry => {
    const plain = normalizeText(entry.text);
    if (/\uFFFD|锟斤拷|烫烫烫|屯屯屯|(?:Ã.|Â.|â€|ðŸ)/u.test(plain)) return true;
    const questionMarks = (plain.match(/\?/g) || []).length;
    return questionMarks >= 3 && questionMarks / Math.max(1, plain.length) > 0.02;
  }).map(entry => entry.id);

  const genericRatio = ratio(genericNotes.length, total);
  const repeatedSignatureRatio = ratio(repeatedSignatureIds.size, total);
  const repeatedContentRatio = ratio(repeatedContentIds.size, total);
  if (invalidScopeIds.length) {
    issues.push({ severity: "fail", code: "INVALID_SCOPE", message: `${platform === "mobile" ? "移动端" : "Web"}作用域格式错误：${invalidScopeIds.join("、")}` });
  }
  if (unstableTargetIds.length) {
    issues.push({ severity: "warning", code: "UNSTABLE_TARGET", message: `禁止使用 nth-child/nth-of-type 作为标注目标：${unstableTargetIds.join("、")}` });
  }
  if (suspiciousText.length) {
    issues.push({ severity: "fail", code: "SUSPICIOUS_TEXT", message: `发现疑似乱码或异常问号：${suspiciousText.join("、")}` });
  }
  if (lowValueAnnotationIds.length) {
    issues.push({ severity: "warning", code: "LOW_VALUE_ANNOTATION", message: `标注只描述常规界面、显而易见操作或泛化跳转，未说明业务规则：${lowValueAnnotationIds.join("、")}` });
  }
  if (total >= 6 && genericRatio > 0.5) {
    issues.push({ severity: "fail", code: "GENERIC_TARGETS", message: `通用容器目标占比 ${Math.round(genericRatio * 100)}%，不得作为主要标注目标` });
  } else if (total >= 6 && genericRatio > 0.25) {
    issues.push({ severity: "warning", code: "GENERIC_TARGETS", message: `通用容器目标占比 ${Math.round(genericRatio * 100)}%，需要改绑具体业务元素` });
  }
  if (total >= 6 && repeatedSignatureRatio > 0.5) {
    issues.push({ severity: "fail", code: "REPEATED_POSITION", message: `跨页面重复 target+x+y 占比 ${Math.round(repeatedSignatureRatio * 100)}%，疑似模板化标注` });
  } else if (total >= 6 && repeatedSignatureRatio > 0.25) {
    issues.push({ severity: "warning", code: "REPEATED_POSITION", message: `跨页面重复 target+x+y 占比 ${Math.round(repeatedSignatureRatio * 100)}%，需要人工复核` });
  }
  if (total >= 6 && repeatedContentRatio > 0.5) {
    issues.push({ severity: "fail", code: "REPEATED_CONTENT", message: `跨页面重复标注内容占比 ${Math.round(repeatedContentRatio * 100)}%，疑似为凑数量复制` });
  } else if (total >= 6 && repeatedContentRatio > 0.25) {
    issues.push({ severity: "warning", code: "REPEATED_CONTENT", message: `跨页面重复标注内容占比 ${Math.round(repeatedContentRatio * 100)}%，需要人工复核` });
  }

  const targetDistribution = Array.from(groupBy(notes, note => normalizeSelector(note.target)).entries())
    .map(([target, group]) => ({ target, count: group.length }))
    .sort((a, b) => b.count - a.count || a.target.localeCompare(b.target, "zh-CN"))
    .slice(0, 12);
  const scopeCounts = Object.fromEntries(Array.from(groupBy(notes, note => note.scope).entries()).map(([scope, group]) => [scope, group.length]));
  const status = issues.some(issue => issue.severity === "fail") ? "fail" : issues.length ? "warning" : "pass";
  return {
    status,
    platform,
    annotations: total,
    scopes: Object.keys(scopeCounts).length,
    uniqueTargets: new Set(notes.map(note => normalizeSelector(note.target))).size,
    genericTargetRatio: genericRatio,
    repeatedSignatureRatio,
    repeatedContentRatio,
    suspiciousTextCount: suspiciousText.length,
    unstableTargetCount: unstableTargetIds.length,
    invalidScopeCount: invalidScopeIds.length,
    lowValueAnnotationCount: lowValueAnnotationIds.length,
    lowValueAnnotationIds,
    scopeCounts,
    targetDistribution,
    repeatedSignatures: repeatedSignatures.sort((a, b) => b.count - a.count).slice(0, 10),
    issues
  };
}

export function countElementsWithAttribute(html, attributeName) {
  const withoutEmbeddedCode = String(html)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  const attributePattern = new RegExp(`\\s${attributeName}(?=\\s|=|/?>)`, "i");
  return (withoutEmbeddedCode.match(/<(?![!/?])[a-z][^>]*>/gi) || [])
    .filter(tag => attributePattern.test(tag)).length;
}

export function attributeValuesOnMarkedElements(html, markerAttribute, valueAttribute) {
  const withoutEmbeddedCode = String(html)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  const markerPattern = new RegExp(`\\s${markerAttribute}(?=\\s|=|/?>)`, "i");
  const valuePattern = new RegExp(`\\s${valueAttribute}\\s*=\\s*(["'])(.*?)\\1`, "i");
  return (withoutEmbeddedCode.match(/<(?![!/?])[a-z][^>]*>/gi) || [])
    .filter(tag => markerPattern.test(tag))
    .map(tag => tag.match(valuePattern)?.[2] || "");
}
