export type PageEvidenceMode = "off" | "filtered" | "full";

export interface ClosestClassMatch {
  from: string;
  to: string;
  distance: number;
  source: "css" | "dom";
}

export interface PageEvidence {
  failingSelector?: string;
  cssClassNames?: string[];
  cssRulesExcerpt?: string;
  domExcerpt?: string;
  closestClassMatch?: ClosestClassMatch;
  pageEvidenceMode?: PageEvidenceMode;
}

export function getPageEvidenceMode(): PageEvidenceMode {
  const raw = (process.env.LMSTUDIO_PAGE_EVIDENCE ?? "filtered").toLowerCase();
  if (raw === "off" || raw === "false" || raw === "0") return "off";
  if (raw === "full") return "full";
  return "filtered";
}

export function getMaxPageEvidenceChars(): number {
  const n = Number(process.env.LMSTUDIO_MAX_PAGE_EVIDENCE_CHARS ?? 12000);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 12000;
}

function truncate(text: string, maxChars: number, label: string): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}… [truncated ${label}]`;
}

function extractCssClasses(cssText: string): string[] {
  const classes = new Set<string>();
  for (const match of cssText.matchAll(/\.([a-zA-Z_][\w-]*)/g)) {
    classes.add(match[1]);
  }
  return [...classes];
}

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let i = 0; i < rows; i++) matrix[i][0] = i;
  for (let j = 0; j < cols; j++) matrix[0][j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[a.length][b.length];
}

function selectorToken(selector: string): string {
  const trimmed = selector.trim();
  const quoted = trimmed.match(/^['"](.+)['"]$/);
  const raw = quoted?.[1] ?? trimmed;
  return raw.replace(/^\.|^#/, "").toLowerCase();
}

const GENERIC_SELECTOR_PARTS = new Set([
  "item",
  "list",
  "container",
  "label",
  "wrapper",
  "button",
  "link",
  "icon",
  "menu",
  "header",
  "footer",
  "title",
  "desc",
  "name",
  "price",
]);

export function filterRelevantClasses(failingSelector: string, classNames: string[]): string[] {
  const token = selectorToken(failingSelector);
  if (!token) return [];

  const parts = token
    .split(/[_-]/)
    .filter((part) => part.length >= 3 && !GENERIC_SELECTOR_PARTS.has(part));
  const matches = classNames.filter((cls) => {
    const lower = cls.toLowerCase();
    if (lower === token) return true;
    if (levenshtein(token, lower) <= 3) return true;
    return parts.some((part) => {
      const segment = new RegExp(`(^|_)${part}(_|$)`);
      return segment.test(lower);
    });
  });

  return [...new Set(matches)].sort((a, b) => levenshtein(token, a) - levenshtein(token, b));
}

function extractRelevantCssRules(cssText: string, classNames: string[]): string {
  if (classNames.length === 0) return "";

  const rules: string[] = [];
  for (const chunk of cssText.split("}")) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const rule = `${trimmed}}`;
    if (classNames.some((cls) => rule.includes(`.${cls}`))) {
      rules.push(rule);
    }
  }
  return rules.join("");
}

function excerptDom(html: string, anchors: string[], maxChars: number): string {
  if (html.length <= maxChars) return html;

  for (const anchor of anchors) {
    if (!anchor) continue;
    const patterns = [`class="${anchor}"`, `class="${anchor} `, `data-test="${anchor}"`];
    for (const pattern of patterns) {
      const idx = html.indexOf(pattern);
      if (idx >= 0) {
        const start = Math.max(0, idx - 400);
        return truncate(html.slice(start, start + maxChars), maxChars, "domExcerpt");
      }
    }
  }

  return truncate(html, maxChars, "domExcerpt");
}

function extractDomClassNames(domHtml: string): string[] {
  const classes = new Set<string>();
  for (const match of domHtml.matchAll(/class="([^"]+)"/g)) {
    for (const cls of match[1].split(/\s+/)) {
      if (cls) classes.add(cls);
    }
  }
  return [...classes];
}

export function findClosestClassMatch(
  failingSelector: string,
  cssClasses: string[],
  domClasses: string[],
): ClosestClassMatch | undefined {
  if (!failingSelector.trim().startsWith(".")) return undefined;

  const token = selectorToken(failingSelector);
  if (!token) return undefined;

  let best: ClosestClassMatch | undefined;

  for (const cls of cssClasses) {
    const distance = levenshtein(token, cls.toLowerCase());
    if (distance === 0 || distance > 3) continue;
    const candidate: ClosestClassMatch = {
      from: failingSelector,
      to: `.${cls}`,
      distance,
      source: "css",
    };
    if (!best || distance < best.distance) best = candidate;
  }

  for (const cls of domClasses) {
    const distance = levenshtein(token, cls.toLowerCase());
    if (distance === 0 || distance > 3) continue;
    const candidate: ClosestClassMatch = {
      from: failingSelector,
      to: `.${cls}`,
      distance,
      source: "dom",
    };
    if (!best || distance < best.distance) best = candidate;
  }

  return best;
}

/** Match a wrong #id selector to id/data-test on the live DOM (e.g. #btn-checkout → [data-test="checkout"]). */
export function findDomSelectorReplacement(
  failingSelector: string,
  domHtml?: string,
  errorContextMd?: string,
): string | undefined {
  const trimmed = failingSelector.trim();
  if (!trimmed.startsWith("#")) return undefined;

  const badId = trimmed.slice(1).toLowerCase();
  const haystack = `${domHtml ?? ""}\n${errorContextMd ?? ""}`;
  if (!haystack.trim()) return undefined;

  const ids = new Set<string>();
  for (const match of haystack.matchAll(/\bid="([^"]+)"/gi)) {
    ids.add(match[1]);
  }

  const dataTests = new Set<string>();
  for (const match of haystack.matchAll(/data-test="([^"]+)"/gi)) {
    dataTests.add(match[1]);
  }

  const stem = badId.replace(/^btn-/, "");

  for (const id of ids) {
    if (id.toLowerCase() === stem) {
      const dt = [...dataTests].find((d) => d.toLowerCase() === stem);
      if (dt) return `[data-test="${dt}"]`;
      return `#${id}`;
    }
  }

  for (const dt of dataTests) {
    if (dt.toLowerCase() === stem) return `[data-test="${dt}"]`;
  }

  if (/button "Checkout"/i.test(haystack) && stem.includes("checkout")) {
    const checkoutTest = [...dataTests].find((d) => d.toLowerCase() === "checkout");
    if (checkoutTest) return `[data-test="${checkoutTest}"]`;
    const checkoutId = [...ids].find((id) => id.toLowerCase() === "checkout");
    if (checkoutId) return `#${checkoutId}`;
  }

  return undefined;
}

export function buildPageEvidence(
  pageHtml: string | undefined,
  pageCss: string | undefined,
  failingSelector: string | undefined,
  mode: PageEvidenceMode = getPageEvidenceMode(),
): PageEvidence | undefined {
  if (mode === "off" || (!pageHtml && !pageCss)) return undefined;

  const maxChars = getMaxPageEvidenceChars();
  const cssBudget = Math.floor(maxChars * 0.45);
  const domBudget = Math.floor(maxChars * 0.55);

  const cssText = pageCss ?? "";
  const htmlText = pageHtml ?? "";
  const allCssClasses = extractCssClasses(cssText);
  const relevantClasses =
    failingSelector && mode === "filtered"
      ? filterRelevantClasses(failingSelector, allCssClasses)
      : allCssClasses;

  let cssRulesExcerpt =
    mode === "full" ? cssText : extractRelevantCssRules(cssText, relevantClasses);
  if (cssRulesExcerpt) {
    cssRulesExcerpt = truncate(cssRulesExcerpt, cssBudget, "cssRulesExcerpt");
  }

  const anchors =
    relevantClasses.length > 0
      ? relevantClasses
      : failingSelector
        ? [selectorToken(failingSelector)]
        : [];
  const domExcerpt = htmlText ? excerptDom(htmlText, anchors, domBudget) : undefined;
  const domClasses = domExcerpt ? extractDomClassNames(domExcerpt) : [];

  const closestClassMatch =
    failingSelector && (relevantClasses.length > 0 || domClasses.length > 0)
      ? findClosestClassMatch(failingSelector, relevantClasses, domClasses)
      : undefined;

  const evidence: PageEvidence = {
    failingSelector,
    pageEvidenceMode: mode,
  };

  if (relevantClasses.length > 0) {
    evidence.cssClassNames = relevantClasses.slice(0, 40);
  }
  if (cssRulesExcerpt) {
    evidence.cssRulesExcerpt = cssRulesExcerpt;
  }
  if (domExcerpt) {
    evidence.domExcerpt = domExcerpt;
  }
  if (closestClassMatch) {
    evidence.closestClassMatch = closestClassMatch;
  }

  if (!evidence.cssClassNames && !evidence.cssRulesExcerpt && !evidence.domExcerpt) {
    return undefined;
  }

  return evidence;
}
