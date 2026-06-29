import type { FailedTest } from "./playwright-results";
import { classifyFailure } from "./failure-classifier";
import { chatJson, chatText } from "./llm";
import { logLlmExchange } from "./llm-log";
import {
  estimateTokens,
  mergeApiUsage,
  type TokenCallRecord,
} from "./token-estimate";

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
- Read ALL failure fields: errorDetail, callLog, failureLocation, errorContextMd, pipelineHint.
- If callLog contains "waiting for locator(...)" or errorContextMd shows a bad selector / page snapshot mismatch, classify as locators-broken — NOT timing-flaky — even when Summary says "Test timeout exceeded".
- Compare selectors in the failing line vs other lines in errorContextMd test source (e.g. #pwd vs #password).`;

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

/** Typical JSON fix-plan response size per test. */
const ESTIMATED_OUTPUT_TOKENS_FIX_PLAN = 350;
const ESTIMATED_OUTPUT_TOKENS_ANALYSIS = 450;
const ESTIMATED_OUTPUT_TOKENS_EXEC_SUMMARY = 200;

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

  const detected = classifyFailure(f);
  if (detected) {
    payload.pipelineHint = {
      category: detected.category,
      confidence: detected.confidence,
      rootCauseSummary: detected.rootCauseSummary,
      proposedChangeSummary: detected.proposedChangeSummary,
    };
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

function fixPlanInputText(system: string, user: string): string {
  return `${system}\n\nReturn ONLY valid JSON. No markdown fences, no commentary.\n\n${user}`;
}

export function estimateFixPlanInputTokens(ctx: StandardsContext, failures: FailedTest[]): number {
  return estimateTokens(fixPlanInputText(FIX_PLAN_SYSTEM, buildPlanUserPrompt(ctx, failures)));
}

export function estimateAnalysisInputTokens(
  ctx: StandardsContext,
  failures: FailedTest[],
  testLabel: string,
  stats: { passed: number; failed: number; skipped: number },
): number {
  const system = "You are an expert test result analyst. Write sharp, actionable markdown for engineers.";
  return estimateTokens(`${system}\n\n${buildAnalysisUserPrompt(ctx, failures, testLabel, stats)}`);
}

export function estimateRunInputTokens(
  ctx: StandardsContext,
  failures: FailedTest[],
  stats: { passed: number; failed: number; skipped: number },
): {
  fixPlanInputTokens: number;
  analysisInputTokens: number;
  executiveSummaryInputTokens: number;
  totalInputTokens: number;
  estimatedOutputTokens: number;
  estimatedTotalTokens: number;
  perTestCalls: number;
  batchSize: number;
} {
  const batchSize = getBatchSize();
  const batches = chunk(failures, batchSize);
  let fixPlanInputTokens = 0;
  let analysisInputTokens = 0;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    fixPlanInputTokens += estimateFixPlanInputTokens(ctx, batch);
    const label =
      batchSize === 1
        ? `${i + 1}/${failures.length} — ${batch[0]?.testName ?? "unknown"}`
        : `${i + 1}/${batches.length} (${batch.length} tests)`;
    analysisInputTokens += estimateAnalysisInputTokens(ctx, batch, label, stats);
  }

  const executiveSummaryInputTokens = estimateTokens(
    "You are a QA lead. Write a concise executive summary in 4-6 sentences.\n\n[fix plan JSON ~" +
      failures.length * 400 +
      " chars]",
  );

  const synthesisInputTokens =
    batches.length > 1 && batchSize > 1
      ? estimateTokens("[synthesis of " + batches.length + " batch sections]")
      : 0;

  const perTestCalls = batches.length * 2;
  const extraCalls = 1 + (synthesisInputTokens > 0 ? 1 : 0);
  const estimatedOutputTokens =
    batches.length * (ESTIMATED_OUTPUT_TOKENS_FIX_PLAN + ESTIMATED_OUTPUT_TOKENS_ANALYSIS) +
    ESTIMATED_OUTPUT_TOKENS_EXEC_SUMMARY +
    (synthesisInputTokens > 0 ? 600 : 0);

  const totalInputTokens =
    fixPlanInputTokens + analysisInputTokens + executiveSummaryInputTokens + synthesisInputTokens;

  return {
    fixPlanInputTokens,
    analysisInputTokens,
    executiveSummaryInputTokens,
    totalInputTokens,
    estimatedOutputTokens,
    estimatedTotalTokens: totalInputTokens + estimatedOutputTokens,
    perTestCalls,
    batchSize,
  };
}

export async function requestFixPlanBatch(
  ctx: StandardsContext,
  failures: FailedTest[],
  logLabel = "fix-plan",
): Promise<{ raw: string; tokenRecord: TokenCallRecord }> {
  const user = buildPlanUserPrompt(ctx, failures);
  const estimatedInputTokens = estimateFixPlanInputTokens(ctx, failures);
  const result = await chatJson(FIX_PLAN_SYSTEM, user);
  logLlmExchange({
    label: logLabel,
    system: FIX_PLAN_SYSTEM,
    user,
    response: result.content,
    usage: result.usage,
    meta: {
      type: "fix-plan",
      failureCount: failures.length,
      tests: failures.map((f) => f.testName).join(" | "),
      estimatedInputTokens,
    },
  });
  return {
    raw: result.content,
    tokenRecord: {
      label: logLabel,
      type: "fix-plan",
      testName: failures.length === 1 ? failures[0]?.testName : undefined,
      estimatedInputTokens,
      estimatedOutputTokens: ESTIMATED_OUTPUT_TOKENS_FIX_PLAN,
      ...mergeApiUsage(estimatedInputTokens, result.usage),
    },
  };
}

const ANALYSIS_SYSTEM =
  "You are an expert test result analyst. Write sharp, actionable markdown for engineers.";

export async function requestAnalysisBatch(
  ctx: StandardsContext,
  failures: FailedTest[],
  testLabel: string,
  stats: { passed: number; failed: number; skipped: number },
  logLabel = "analysis",
): Promise<{ markdown: string; tokenRecord: TokenCallRecord }> {
  const user = buildAnalysisUserPrompt(ctx, failures, testLabel, stats);
  const estimatedInputTokens = estimateAnalysisInputTokens(ctx, failures, testLabel, stats);
  const analysisLogLabel = `${logLabel}-${testLabel.replace(/[^\w.-]+/g, "_").slice(0, 60)}`;
  const result = await chatText(ANALYSIS_SYSTEM, user);
  logLlmExchange({
    label: analysisLogLabel,
    system: ANALYSIS_SYSTEM,
    user,
    response: result.content,
    usage: result.usage,
    meta: {
      type: "analysis",
      test: testLabel,
      failureCount: failures.length,
      tests: failures.map((f) => f.testName).join(" | "),
      estimatedInputTokens,
    },
  });
  return {
    markdown: result.content,
    tokenRecord: {
      label: logLabel,
      type: "analysis",
      testName: failures.length === 1 ? failures[0]?.testName : undefined,
      estimatedInputTokens,
      estimatedOutputTokens: ESTIMATED_OUTPUT_TOKENS_ANALYSIS,
      ...mergeApiUsage(estimatedInputTokens, result.usage),
    },
  };
}

export async function requestExecutiveSummary(input: {
  stats: { passed: number; failed: number; skipped: number };
  testEnv: string;
  fixPlanJson: string;
  failureCount: number;
  perTestMode: boolean;
}): Promise<{ summary: string; tokenRecord: TokenCallRecord }> {
  const system = "You are a QA lead. Write a concise executive summary in 4-6 sentences.";
  const user = `TEST_ENV=${input.testEnv}
Results: ${JSON.stringify(input.stats)}
Analyzed ${input.failureCount} failure(s) ${input.perTestMode ? "one test per LLM call" : "in batches"}.

Fix plan (all failures):
${input.fixPlanJson}

Summarize: overall health, main failure themes, top priority fixes, how many may auto-heal.`;
  const estimatedInputTokens = estimateTokens(`${system}\n\n${user}`);
  const result = await chatText(system, user);
  logLlmExchange({
    label: "executive-summary",
    system,
    user,
    response: result.content,
    usage: result.usage,
    meta: {
      type: "executive-summary",
      failureCount: input.failureCount,
      estimatedInputTokens,
    },
  });
  return {
    summary: result.content,
    tokenRecord: {
      label: "executive-summary",
      type: "executive-summary",
      estimatedInputTokens,
      estimatedOutputTokens: ESTIMATED_OUTPUT_TOKENS_EXEC_SUMMARY,
      ...mergeApiUsage(estimatedInputTokens, result.usage),
    },
  };
}

export async function requestSynthesisAnalysis(input: {
  batchSections: string[];
  fixPlanJson: string;
}): Promise<{ markdown: string; tokenRecord: TokenCallRecord }> {
  if (input.batchSections.length <= 1) {
    return {
      markdown: input.batchSections[0] ?? "",
      tokenRecord: {
        label: "synthesis-skipped",
        type: "synthesis",
        estimatedInputTokens: 0,
        source: "estimated",
      },
    };
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
  const estimatedInputTokens = estimateTokens(`${system}\n\n${user}`);
  const result = await chatText(system, user);
  logLlmExchange({
    label: "synthesis",
    system,
    user,
    response: result.content,
    usage: result.usage,
    meta: {
      type: "synthesis",
      batchCount: input.batchSections.length,
      estimatedInputTokens,
    },
  });
  return {
    markdown: result.content,
    tokenRecord: {
      label: "synthesis",
      type: "synthesis",
      estimatedInputTokens,
      estimatedOutputTokens: 600,
      ...mergeApiUsage(estimatedInputTokens, result.usage),
    },
  };
}
