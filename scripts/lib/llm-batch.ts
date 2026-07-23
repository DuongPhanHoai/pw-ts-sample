import type { FailedTest } from "./playwright-results";
import {
  compactFailureSummary,
  compactFailureWithDetails,
  DETAIL_FIELD_DESCRIPTIONS,
  type DetailField,
  type FailureTriageGroup,
  type FailureTriageResult,
} from "./failure-triage";
import { chatJson, chatText, type ChatResult } from "./llm";

export type StandardsContext = {
  uiStandards: string;
  evaluationCriteria: string;
  autoHealPolicy: string;
  projectRoot: string;
};

export const FIX_PLAN_SYSTEM = `You are an expert Playwright test analyst. Follow testing standards and auto-heal policy.
Return ONLY valid JSON (no markdown fences) with this exact shape:
{
  "plan": [{
    "testId": "string",
    "testName": "string",
    "category": "locators-broken|timing-flaky|backend-issue|business-logic-change|test-data-issue",
    "canAutoHeal": boolean,
    "confidence": 0.0-1.0,
    "rootCauseSummary": "string",
    "proposedChangeSummary": "string — be specific and actionable",
    "codeChangeHints": [{ "filePath": "string", "reason": "string", "suggestedSelectorOrChange": "string" }]
  }]
}
Rules:
- Return exactly one plan entry for the single failed test in the input (same testName).
- Set canAutoHeal false when policy.categories[category].autoHeal is false.
- proposedChangeSummary must be sharp and concrete (file, selector, wait, or data fix).
- Read ALL failure fields: errorDetail, callLog, failureLocation, errorContextMd, pageEvidence.
- pageEvidence carries CSS class names/rules and a rendered DOM excerpt from page-html / page-css attachments captured at failure — prefer these over guessing when the a11y snapshot lacks CSS classes.
- If pageEvidence.closestClassMatch is present, use it as the primary selector fix (typo near-miss, e.g. .carts_item → .cart_item).
- If callLog contains "waiting for locator(...)" or errorContextMd shows a bad selector / page snapshot mismatch, classify as locators-broken — NOT timing-flaky — even when Summary says "Test timeout exceeded".
- Compare selectors in the failing line vs other lines in errorContextMd test source (e.g. #pwd vs #password).`;

export const TRIAGE_SYSTEM = `You are an expert Playwright test triage analyst.
Return ONLY valid JSON (no markdown fences) with this exact shape:
{
  "groups": [{
    "groupId": "short-kebab-id",
    "representativeTestName": "exact testName from input",
    "memberTestNames": ["every testName in this duplicate group, including representative"],
    "likelyCategory": "locators-broken|timing-flaky|backend-issue|business-logic-change|test-data-issue",
    "triageSummary": "one sentence root cause hypothesis for the group",
    "detailFieldsNeeded": ["..."],
    "duplicateReason": "why these failures are the same issue"
  }],
  "notes": "optional short note about overall failure themes"
}
Rules:
- Step 1 receives SUMMARY ONLY (errorSummary, callLog, failureLocation) — no pageEvidence or errorContextMd yet.
- Group tests that share the same root cause (e.g. same broken selector in the same page object line).
- Every input testName must appear in exactly one memberTestNames list.
- Copy testName strings EXACTLY from the input summaries (including file prefix like "cart-and-checkout.spec.ts > ...").
- Pick one representativeTestName per group (first failure in the duplicate set).
- detailFieldsNeeded must list what extra evidence step 2 needs. Allowed values:
${Object.entries(DETAIL_FIELD_DESCRIPTIONS)
  .map(([key, desc]) => `  - ${key}: ${desc}`)
  .join("\n")}
- For locator / selector failures, usually request pageEvidence and errorContextMd.
- For timing-only issues, errorDetail may suffice.
- Do NOT request fields already sufficient in the summary (callLog, failureLocation are already included).`;

export const FIX_PLAN_DETAIL_SYSTEM = `${FIX_PLAN_SYSTEM}
Additional rules for step 2:
- Input includes triage context and ONLY the detail fields you previously requested.
- Fix applies to ALL memberTestNames in the group — return one plan entry for the representative testName.
- proposedChangeSummary must apply to every duplicate in the group.`;

/** Default 1 = one failed test per LLM call (safer, smaller payloads). Set LMSTUDIO_BATCH_SIZE>1 to batch. */
export function getBatchSize(): number {
  const n = Number(process.env.LMSTUDIO_BATCH_SIZE ?? 1);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

export function isPerTestMode(): boolean {
  return getBatchSize() === 1;
}

export function getMaxErrorChars(): number {
  const n = Number(process.env.LMSTUDIO_MAX_ERROR_CHARS ?? 2000);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 2000;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function truncate(text: string, maxChars: number, label: string): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}… [truncated ${label}]`;
}

/** Compact failure for prompts — prioritizes call log + error-context over generic timeout summary. */
export function compactFailure(f: FailedTest, maxErrorChars = getMaxErrorChars()) {
  const maxContextChars = Math.max(maxErrorChars, 6000);
  const payload: Record<string, unknown> = {
    testId: f.testId,
    testName: f.testName,
    file: f.file,
    line: f.line,
    tags: f.tags,
    durationMs: f.durationMs,
  };

  if (f.errorSummary) {
    payload.errorSummary = f.errorSummary;
  }

  if (f.failureLocation) {
    payload.failureLocation = f.failureLocation;
  }

  if (f.callLog) {
    payload.callLog = f.callLog;
  }

  const detailParts: string[] = [];
  const detailMatch = f.error.match(/Detail:\n([\s\S]*?)(?:\n\nFailure at:|$)/);
  if (detailMatch?.[1]) {
    detailParts.push(detailMatch[1].trim());
  } else if (!f.callLog && !f.errorContextMd) {
    detailParts.push(f.error);
  }

  if (detailParts.length > 0) {
    payload.errorDetail = truncate(detailParts.join("\n\n"), maxErrorChars, "errorDetail");
  }

  if (f.errorContextMd) {
    payload.errorContextMd = truncate(f.errorContextMd, maxContextChars, "errorContextMd");
  }

  if (f.pageEvidence) {
    payload.pageEvidence = f.pageEvidence;
  }

  return payload;
}

function standardsBlock(ctx: StandardsContext, compact: boolean): string {
  if (compact) {
    return `## Evaluation criteria (summary)
${ctx.evaluationCriteria.slice(0, 1800)}

## Auto-heal policy
${ctx.autoHealPolicy}`;
  }

  return `## Testing standards
${ctx.uiStandards}

## Evaluation criteria
${ctx.evaluationCriteria}

## Auto-heal policy
${ctx.autoHealPolicy}`;
}

export function buildTriageUserPrompt(
  ctx: StandardsContext,
  failures: FailedTest[],
  stats: { passed: number; failed: number; skipped: number },
): string {
  const summaries = failures.map((f) => compactFailureSummary(f));
  return `Project root: ${ctx.projectRoot.replace(/\\/g, "/")}
Stats: ${JSON.stringify(stats)}

${standardsBlock(ctx, true)}

## Failed test summaries (${failures.length}) — step 1 triage only
Review duplicates, group by root cause, and decide detailFieldsNeeded for step 2.
${JSON.stringify(summaries, null, 2)}`;
}

export interface FailureTriageLlmResult {
  triage: FailureTriageResult;
  prompt: {
    system: string;
    user: string;
  };
  response: {
    content: string;
    rawContent?: string;
    usage?: ChatResult["usage"];
    logPath?: string;
  };
}

export function buildFixPlanDetailUserPrompt(
  ctx: StandardsContext,
  group: FailureTriageGroup,
  representative: FailedTest,
): string {
  const detailPayload = compactFailureWithDetails(
    representative,
    group.detailFieldsNeeded as DetailField[],
  );

  return `Project root: ${ctx.projectRoot.replace(/\\/g, "/")}

${standardsBlock(ctx, true)}

## Triage group (step 1 result)
${JSON.stringify(group, null, 2)}

## Representative failure with requested detail fields
detailFieldsIncluded: ${JSON.stringify(group.detailFieldsNeeded)}
${JSON.stringify(detailPayload, null, 2)}

Return exactly one fix plan entry for representativeTestName. The fix applies to all memberTestNames.`;
}

export async function requestFailureTriage(
  ctx: StandardsContext,
  failures: FailedTest[],
  stats: { passed: number; failed: number; skipped: number },
): Promise<FailureTriageResult> {
  const result = await requestFailureTriageWithDebug(ctx, failures, stats);
  return result.triage;
}

export async function requestFailureTriageWithDebug(
  ctx: StandardsContext,
  failures: FailedTest[],
  stats: { passed: number; failed: number; skipped: number },
): Promise<FailureTriageLlmResult> {
  const user = buildTriageUserPrompt(ctx, failures, stats);
  const result = await chatJson(TRIAGE_SYSTEM, user, {
    label: "failure-triage",
    meta: {
      type: "failure-triage",
      failureCount: failures.length,
    },
  });

  return {
    triage: JSON.parse(result.content) as FailureTriageResult,
    prompt: {
      system: result.system ?? TRIAGE_SYSTEM,
      user: result.user ?? user,
    },
    response: {
      content: result.content,
      rawContent: result.rawContent,
      usage: result.usage,
      logPath: result.logPath,
    },
  };
}

export async function requestFixPlanForGroup(
  ctx: StandardsContext,
  group: FailureTriageGroup,
  representative: FailedTest,
  logLabel = "fix-plan-group",
): Promise<string> {
  const user = buildFixPlanDetailUserPrompt(ctx, group, representative);
  const result = await chatJson(FIX_PLAN_DETAIL_SYSTEM, user, {
    label: logLabel,
    meta: {
      type: "fix-plan-detail",
      groupId: group.groupId,
      representative: group.representativeTestName,
      memberCount: group.memberTestNames.length,
      detailFields: group.detailFieldsNeeded,
    },
  });
  return result.content;
}

export function buildPlanUserPrompt(ctx: StandardsContext, failures: FailedTest[]): string {
  const compact = failures.map((f) => compactFailure(f));
  const perTest = failures.length === 1;
  return `Project root: ${ctx.projectRoot.replace(/\\/g, "/")}

${standardsBlock(ctx, perTest)}

## Failed test${failures.length === 1 ? "" : "s"} (${failures.length})${perTest ? " — analyze this one only" : " — analyze ALL of these"}
${JSON.stringify(compact, null, 2)}`;
}

export function buildAnalysisUserPrompt(
  ctx: StandardsContext,
  failures: FailedTest[],
  testLabel: string,
  stats: { passed: number; failed: number; skipped: number },
): string {
  const compact = failures.map((f) => compactFailure(f));
  const perTest = failures.length === 1;
  return `Test: ${testLabel}
Stats (full run): ${JSON.stringify(stats)}

${standardsBlock(ctx, true)}

## Failed test${perTest ? "" : "s in this batch"} — analyze ${perTest ? "this test" : "EVERY test below"}
${JSON.stringify(compact, null, 2)}

Write markdown for ${perTest ? "this test" : "this batch"}:
- ### with test name, category, root cause, sharp fix suggestion
- Be specific (selectors, files under tests/, waits, data)`;
}

export async function requestFixPlanBatch(
  ctx: StandardsContext,
  failures: FailedTest[],
  logLabel = "fix-plan",
): Promise<string> {
  const user = buildPlanUserPrompt(ctx, failures);
  const result = await chatJson(FIX_PLAN_SYSTEM, user, {
    label: logLabel,
    meta: {
      type: "fix-plan",
      failureCount: failures.length,
      tests: failures.map((f) => f.testName).join(" | "),
    },
  });
  return result.content;
}

const ANALYSIS_SYSTEM =
  "You are an expert test result analyst. Write sharp, actionable markdown for engineers.";

export async function requestAnalysisBatch(
  ctx: StandardsContext,
  failures: FailedTest[],
  testLabel: string,
  stats: { passed: number; failed: number; skipped: number },
  logLabel = "analysis",
): Promise<string> {
  const user = buildAnalysisUserPrompt(ctx, failures, testLabel, stats);
  const analysisLogLabel = `${logLabel}-${testLabel.replace(/[^\w.-]+/g, "_").slice(0, 60)}`;
  const result = await chatText(ANALYSIS_SYSTEM, user, {
    label: analysisLogLabel,
    meta: {
      type: "analysis",
      test: testLabel,
      failureCount: failures.length,
      tests: failures.map((f) => f.testName).join(" | "),
    },
  });
  return result.content;
}

export async function requestExecutiveSummary(input: {
  stats: { passed: number; failed: number; skipped: number };
  testEnv: string;
  fixPlanJson: string;
  failureCount: number;
  perTestMode: boolean;
  /** When set, documents which fix plan variant is in fixPlanJson (for logging). */
  fixPlanSource?: "llm-step2" | "final";
}): Promise<string> {
  const planLabel =
    input.fixPlanSource === "llm-step2"
      ? "Fix plan from step 2 LLM (before classifier adjustments)"
      : "Fix plan (all failures)";
  const system = "You are a QA lead. Write a concise executive summary in 4-6 sentences.";
  const user = `TEST_ENV=${input.testEnv}
Results: ${JSON.stringify(input.stats)}
Analyzed ${input.failureCount} failure(s) ${input.perTestMode ? "one test per LLM call" : "in batches"}.

${planLabel}:
${input.fixPlanJson}

Summarize: overall health, main failure themes, top priority fixes, how many may auto-heal.
Each plan entry is ONE fix for a duplicate group — use appliesToCount / memberTestNames for how many tests it covers. Do NOT list separate fixes for duplicate members.`;
  const result = await chatText(system, user, {
    label: "executive-summary",
    meta: {
      type: "executive-summary",
      failureCount: input.failureCount,
      fixPlanSource: input.fixPlanSource ?? "final",
    },
  });
  return result.content;
}

export async function requestSynthesisAnalysis(input: {
  batchSections: string[];
  fixPlanJson: string;
}): Promise<string> {
  if (input.batchSections.length <= 1) {
    return input.batchSections[0] ?? "";
  }

  const system = "You are an expert test lead. Merge batch analyses into one coherent report.";
  const user = `Below are per-batch failure analyses. Produce final markdown with:
1. ## Executive summary (themes across ALL failures)
2. ## Failures by category (group all tests)
3. ## Priority actions (ordered list)
4. ## Per-test details (preserve every test from batches — do not drop any)

Batch analyses:
${input.batchSections.join("\n\n---\n\n")}

Reference fix plan for categories:
${input.fixPlanJson}`;
  const result = await chatText(system, user, {
    label: "synthesis",
    meta: {
      type: "synthesis",
      batchCount: input.batchSections.length,
    },
  });
  return result.content;
}
