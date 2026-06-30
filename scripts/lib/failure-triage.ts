import type { FailedTest } from "./playwright-results";
import { classifyFailure, extractWaitingLocatorSelector } from "./failure-classifier";
import type { PageEvidence } from "./page-evidence";

function getMaxErrorChars(): number {
  const n = Number(process.env.LMSTUDIO_MAX_ERROR_CHARS ?? 2000);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 2000;
}

/** Detail blocks the LLM can request in step 2 (step 1 summary omits these). */
export type DetailField =
  | "errorDetail"
  | "errorContextMd"
  | "pageEvidence"
  | "pageEvidenceCssOnly"
  | "pageEvidenceDomOnly";

export const DETAIL_FIELD_DESCRIPTIONS: Record<DetailField, string> = {
  errorDetail: "Full Playwright error message / stack excerpt (beyond errorSummary).",
  errorContextMd:
    "error-context.md attachment: a11y page snapshot + embedded test source.",
  pageEvidence:
    "page-html / page-css evidence: cssClassNames, cssRulesExcerpt, domExcerpt, closestClassMatch.",
  pageEvidenceCssOnly: "pageEvidence CSS subset only (cssClassNames + cssRulesExcerpt).",
  pageEvidenceDomOnly: "pageEvidence DOM subset only (domExcerpt + closestClassMatch).",
};

export interface FailureSummaryItem {
  testId: string;
  testName: string;
  file?: string;
  line?: number;
  durationMs?: number;
  errorSummary?: string;
  callLog?: string;
  failureLocation?: { file: string; line: number; column?: number };
  failingSelector?: string;
  pipelineHint?: {
    category: string;
    confidence: number;
    rootCauseSummary: string;
    proposedChangeSummary: string;
  };
}

export interface FailureTriageGroup {
  groupId: string;
  representativeTestName: string;
  memberTestNames: string[];
  likelyCategory?: string;
  triageSummary: string;
  detailFieldsNeeded: DetailField[];
  duplicateReason?: string;
}

export interface FailureTriageResult {
  groups: FailureTriageGroup[];
  notes?: string;
}

function truncate(text: string, maxChars: number, label: string): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}… [truncated ${label}]`;
}

export function compactFailureSummary(f: FailedTest): FailureSummaryItem {
  const summary: FailureSummaryItem = {
    testId: f.testId,
    testName: f.testName,
    file: f.file,
    line: f.line,
    durationMs: f.durationMs,
  };

  if (f.errorSummary) summary.errorSummary = f.errorSummary;
  if (f.callLog) summary.callLog = f.callLog;
  if (f.failureLocation) summary.failureLocation = f.failureLocation;

  const selector = extractWaitingLocatorSelector(f);
  if (selector) summary.failingSelector = selector;

  const detected = classifyFailure(f);
  if (detected) {
    summary.pipelineHint = {
      category: detected.category,
      confidence: detected.confidence,
      rootCauseSummary: detected.rootCauseSummary,
      proposedChangeSummary: detected.proposedChangeSummary,
    };
  }

  return summary;
}

function slicePageEvidence(
  evidence: PageEvidence | undefined,
  mode: "full" | "css" | "dom",
): PageEvidence | undefined {
  if (!evidence) return undefined;

  if (mode === "full") return evidence;

  if (mode === "css") {
    const out: PageEvidence = { pageEvidenceMode: evidence.pageEvidenceMode };
    if (evidence.failingSelector) out.failingSelector = evidence.failingSelector;
    if (evidence.cssClassNames) out.cssClassNames = evidence.cssClassNames;
    if (evidence.cssRulesExcerpt) out.cssRulesExcerpt = evidence.cssRulesExcerpt;
    return Object.keys(out).length > 1 ? out : undefined;
  }

  const out: PageEvidence = { pageEvidenceMode: evidence.pageEvidenceMode };
  if (evidence.failingSelector) out.failingSelector = evidence.failingSelector;
  if (evidence.domExcerpt) out.domExcerpt = evidence.domExcerpt;
  if (evidence.closestClassMatch) out.closestClassMatch = evidence.closestClassMatch;
  return Object.keys(out).length > 1 ? out : undefined;
}

export function compactFailureWithDetails(
  f: FailedTest,
  fields: DetailField[],
  maxErrorChars = getMaxErrorChars(),
): Record<string, unknown> {
  const base = compactFailureSummary(f);
  const payload: Record<string, unknown> = { ...base };
  const maxContextChars = Math.max(maxErrorChars, 6000);
  const fieldSet = new Set(fields);

  if (fieldSet.has("errorDetail")) {
    const detailMatch = f.error.match(/Detail:\n([\s\S]*?)(?:\n\nFailure at:|$)/);
    const detail = detailMatch?.[1]?.trim() ?? f.error;
    payload.errorDetail = truncate(detail, maxErrorChars, "errorDetail");
  }

  if (fieldSet.has("errorContextMd") && f.errorContextMd) {
    payload.errorContextMd = truncate(f.errorContextMd, maxContextChars, "errorContextMd");
  }

  if (fieldSet.has("pageEvidence")) {
    const evidence = slicePageEvidence(f.pageEvidence, "full");
    if (evidence) payload.pageEvidence = evidence;
  } else {
    if (fieldSet.has("pageEvidenceCssOnly")) {
      const evidence = slicePageEvidence(f.pageEvidence, "css");
      if (evidence) payload.pageEvidence = evidence;
    }
    if (fieldSet.has("pageEvidenceDomOnly")) {
      const evidence = slicePageEvidence(f.pageEvidence, "dom");
      if (evidence) {
        payload.pageEvidenceDom = evidence;
      }
    }
  }

  return payload;
}

export function failureSignature(f: FailedTest): string {
  const loc = f.failureLocation;
  const selector = extractWaitingLocatorSelector(f) ?? "";
  const summary = (f.errorSummary ?? f.error).replace(/\s+/g, " ").slice(0, 240);
  return [loc?.file ?? f.file ?? "", loc?.line ?? f.line ?? "", selector, summary].join("|");
}

export function defaultDetailFieldsForFailure(f: FailedTest): DetailField[] {
  const detected = classifyFailure(f);
  if (detected?.category === "locators-broken") {
    return ["pageEvidence", "errorContextMd"];
  }
  if (f.errorContextMd) return ["errorContextMd", "errorDetail"];
  return ["errorDetail"];
}

export function buildDeterministicTriage(failures: FailedTest[]): FailureTriageResult {
  const bySignature = new Map<string, FailedTest[]>();

  for (const failure of failures) {
    const key = failureSignature(failure);
    const bucket = bySignature.get(key) ?? [];
    bucket.push(failure);
    bySignature.set(key, bucket);
  }

  const groups: FailureTriageGroup[] = [];

  for (const [index, bucket] of [...bySignature.values()].entries()) {
    const representative = bucket[0];
    const detected = classifyFailure(representative);
    const selector = extractWaitingLocatorSelector(representative);
    groups.push({
      groupId: `group-${index + 1}`,
      representativeTestName: representative.testName,
      memberTestNames: bucket.map((f) => f.testName),
      likelyCategory: detected?.category,
      triageSummary:
        detected?.rootCauseSummary ??
        representative.errorSummary ??
        "Repeated failure signature across multiple tests.",
      detailFieldsNeeded: defaultDetailFieldsForFailure(representative),
      duplicateReason: selector
        ? `Same failure location and locator (${selector})`
        : "Same error signature and failure location",
    });
  }

  return {
    groups,
    notes: "Deterministic triage fallback (grouped by failure signature).",
  };
}

export function normalizeDetailFields(raw: string[] | undefined): DetailField[] {
  const allowed = new Set<string>(Object.keys(DETAIL_FIELD_DESCRIPTIONS));
  const out: DetailField[] = [];
  for (const field of raw ?? []) {
    if (allowed.has(field) && !out.includes(field as DetailField)) {
      out.push(field as DetailField);
    }
  }
  return out.length > 0 ? out : ["errorDetail"];
}

export function resolveTriageGroups(
  triage: FailureTriageResult,
  failures: FailedTest[],
): Array<{
  group: FailureTriageGroup;
  representative: FailedTest;
  members: FailedTest[];
}> {
  const byName = new Map(failures.map((f) => [f.testName, f]));
  const assigned = new Set<string>();
  const resolved: Array<{
    group: FailureTriageGroup;
    representative: FailedTest;
    members: FailedTest[];
  }> = [];

  for (const group of triage.groups) {
    const rep = byName.get(group.representativeTestName);
    if (!rep) continue;

    const members = group.memberTestNames
      .map((name) => byName.get(name))
      .filter((f): f is FailedTest => Boolean(f));

    const uniqueMembers = members.length > 0 ? members : [rep];
    for (const m of uniqueMembers) assigned.add(m.testName);

    resolved.push({
      group: {
        ...group,
        memberTestNames: uniqueMembers.map((m) => m.testName),
        detailFieldsNeeded: normalizeDetailFields(group.detailFieldsNeeded),
      },
      representative: rep,
      members: uniqueMembers,
    });
  }

  for (const failure of failures) {
    if (assigned.has(failure.testName)) continue;
    resolved.push({
      group: {
        groupId: `ungrouped-${failure.testId}`,
        representativeTestName: failure.testName,
        memberTestNames: [failure.testName],
        triageSummary: failure.errorSummary ?? "Ungrouped failure",
        detailFieldsNeeded: defaultDetailFieldsForFailure(failure),
      },
      representative: failure,
      members: [failure],
    });
  }

  return resolved;
}

export function renderTriageAnalysisMarkdown(
  triage: FailureTriageResult,
  groupCount: number,
  failureCount: number,
): string {
  const lines = [
    "## Step 1 — Failure triage",
    "",
    triage.notes ? `${triage.notes}\n` : "",
    `Grouped **${failureCount}** failure(s) into **${groupCount}** group(s).\n`,
  ];

  for (const group of triage.groups) {
    lines.push(`### ${group.groupId}: ${group.representativeTestName}`);
    lines.push(`- **Duplicates:** ${group.memberTestNames.length} test(s)`);
    if (group.duplicateReason) lines.push(`- **Why grouped:** ${group.duplicateReason}`);
    if (group.likelyCategory) lines.push(`- **Likely category:** ${group.likelyCategory}`);
    lines.push(`- **Triage:** ${group.triageSummary}`);
    lines.push(
      `- **Detail requested for step 2:** ${group.detailFieldsNeeded.join(", ") || "errorDetail"}`,
    );
    if (group.memberTestNames.length > 1) {
      lines.push("- **Affected tests:**");
      for (const name of group.memberTestNames) {
        lines.push(`  - ${name}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}
