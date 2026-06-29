import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { chatText } from "./lib/llm";
import {
  chunk,
  estimateRunInputTokens,
  getBatchSize,
  isPerTestMode,
  requestAnalysisBatch,
  requestExecutiveSummary,
  requestFixPlanBatch,
  requestSynthesisAnalysis,
  type StandardsContext,
} from "./lib/llm-batch";
import { getFailureLimit, logLlmExchange, shouldLogLlmPrompts } from "./lib/llm-log";
import { applyDeterministicClassification, classifyFailure } from "./lib/failure-classifier";
import { loadTestRun, type FailedTest } from "./lib/playwright-results";
import { paths, projectRoot } from "./lib/paths";
import {
  buildAiTestReport,
  renderAiTestReportMarkdown,
  type FixPlanItem,
} from "./lib/test-report";
import { formatTokenSummary } from "./lib/token-estimate";
import { TokenTracker } from "./lib/token-tracker";

const FixPlanItemSchema = z.object({
  testId: z.string(),
  testName: z.string(),
  category: z.enum([
    "locators-broken",
    "timing-flaky",
    "backend-issue",
    "business-logic-change",
    "test-data-issue",
  ]),
  canAutoHeal: z.boolean(),
  confidence: z.number().min(0).max(1).optional(),
  rootCauseSummary: z.string().optional(),
  proposedChangeSummary: z.string(),
  codeChangeHints: z.array(
    z.object({
      filePath: z.string(),
      reason: z.string(),
      suggestedSelectorOrChange: z.string(),
    }),
  ),
});

const FixPlanSchema = z.object({
  plan: z.array(FixPlanItemSchema),
});

async function main(): Promise<void> {
  fs.mkdirSync(path.dirname(paths.resultsJson), { recursive: true });

  const run = loadTestRun(paths.resultsJson);
  const testEnv = process.env.TEST_ENV ?? "test";
  const batchSize = getBatchSize();
  const perTestMode = isPerTestMode();
  const failureLimit = getFailureLimit();
  const tokenTracker = new TokenTracker();

  let failuresToAnalyze = run.failures;
  if (failureLimit !== undefined && failureLimit < run.failures.length) {
    failuresToAnalyze = run.failures.slice(0, failureLimit);
    console.log(
      `LMSTUDIO_FAILURE_LIMIT=${failureLimit} — analyzing first ${failureLimit} of ${run.failures.length} failures only`,
    );
  }

  const stats = { passed: run.passed, failed: run.failed, skipped: run.skipped };

  console.log(
    `Results: ${run.passed} passed, ${run.failed} failed, ${run.skipped} skipped`,
  );
  if (shouldLogLlmPrompts()) {
    console.log("LMSTUDIO_LOG_PROMPTS=true — full payloads logged to reports/llm-prompts/");
  }

  let fixPlan: FixPlanItem[] = [];
  let aiAnalysis = "";
  let aiSummary = "";

  if (run.failures.length === 0) {
    const system = "You are a QA lead. Write 2-3 sentences in plain English.";
    const user = `All Playwright tests passed.
Environment: TEST_ENV=${testEnv}
Passed: ${run.passed}, Failed: 0, Skipped: ${run.skipped}
Confirm success and note no fixes are needed.`;
    const result = await chatText(system, user).catch(() => ({
      content: "All tests passed. No failures detected. No fixes required.",
    }));
    logLlmExchange({
      label: "all-passed-summary",
      system,
      user,
      response: result.content,
      usage: "usage" in result ? result.usage : undefined,
      meta: { type: "all-passed-summary" },
    });
    aiSummary = result.content;
  } else {
    const ctx: StandardsContext = {
      uiStandards: fs.readFileSync(paths.uiStandards, "utf8"),
      evaluationCriteria: fs.readFileSync(paths.evaluationCriteria, "utf8"),
      autoHealPolicy: fs.readFileSync(paths.autoHealPolicy, "utf8"),
      projectRoot,
    };

    const preEstimate = estimateRunInputTokens(ctx, failuresToAnalyze, stats);
    console.log(
      perTestMode
        ? `Mode: one failed test per LLM call (${failuresToAnalyze.length} tests × 2 calls + summary)`
        : `Mode: batch size ${batchSize} (${chunk(failuresToAnalyze, batchSize).length} batches × 2 calls + summary)`,
    );
    console.log(
      `Token pre-estimate: ~${preEstimate.totalInputTokens.toLocaleString()} input + ~${preEstimate.estimatedOutputTokens.toLocaleString()} output ≈ ~${preEstimate.estimatedTotalTokens.toLocaleString()} total`,
    );

    const batches = chunk(failuresToAnalyze, batchSize);

    fixPlan = await buildFixPlanAll(ctx, failuresToAnalyze, batches, tokenTracker);
    const fixPlanJson = JSON.stringify({ plan: fixPlan }, null, 2);
    aiAnalysis = await buildAnalysisAll(ctx, batches, stats, fixPlanJson, tokenTracker);

    const execResult = await requestExecutiveSummary({
      stats,
      testEnv,
      fixPlanJson,
      failureCount: failuresToAnalyze.length,
      perTestMode,
    }).catch(() => ({
      summary: `${run.failed} test(s) failed. See Tests to fix in ai-test-report.md for per-test suggestions.`,
      tokenRecord: {
        label: "executive-summary-fallback",
        type: "executive-summary" as const,
        estimatedInputTokens: 0,
        source: "estimated" as const,
      },
    }));
    tokenTracker.record(execResult.tokenRecord);
    aiSummary = execResult.summary;
  }

  const tokenReportPath = path.join(path.dirname(paths.resultsJson), "ai-token-estimate.json");
  fs.writeFileSync(tokenReportPath, JSON.stringify(tokenTracker.toJson(), null, 2), "utf8");

  const report = buildAiTestReport({
    run: { ...run, failures: failuresToAnalyze },
    fixPlan,
    aiSummary,
  });
  const reportMarkdown = renderAiTestReportMarkdown(report);

  fs.writeFileSync(paths.aiTestReport, reportMarkdown, "utf8");
  fs.writeFileSync(paths.aiTestReportJson, JSON.stringify(report, null, 2), "utf8");

  if (run.failures.length === 0) {
    fs.writeFileSync(
      paths.aiAnalysis,
      `# AI Test Analysis\n\n${aiSummary}\n`,
      "utf8",
    );
    fs.writeFileSync(paths.aiFixPlan, JSON.stringify({ plan: [] }, null, 2), "utf8");
  } else {
    const modeLabel = perTestMode ? "one test per LLM call" : `batch size ${batchSize}`;
    const tokenBlock = formatTokenSummary(tokenTracker.summary());
    const header = `# AI Test Analysis

Generated: ${new Date().toISOString()}
Failures analyzed: ${failuresToAnalyze.length}${failureLimit ? ` (limit ${failureLimit} of ${run.failures.length} total failures)` : ""}
Mode: ${modeLabel}

## Token usage
${tokenBlock}

---

`;
    fs.writeFileSync(paths.aiAnalysis, header + aiAnalysis, "utf8");
    fs.writeFileSync(
      paths.aiFixPlan,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          failureCount: failuresToAnalyze.length,
          batchSize,
          perTestMode,
          tokenSummary: tokenTracker.summary(),
          plan: fixPlan,
        },
        null,
        2,
      ),
      "utf8",
    );
  }

  console.log(`Wrote ${paths.aiTestReport}`);
  console.log(`Wrote ${paths.aiTestReportJson}`);
  console.log(`Status: ${report.overallStatus.toUpperCase()} — ${report.headline}`);
  if (failuresToAnalyze.length > 0) {
    console.log(`Wrote ${paths.aiAnalysis}`);
    console.log(`Fix plan coverage: ${fixPlan.length}/${failuresToAnalyze.length} tests`);
    console.log(`Wrote ${paths.aiFixPlan}`);
    console.log(`Wrote ${tokenReportPath}`);
    console.log(formatTokenSummary(tokenTracker.summary()));
  }
}

function testLabel(
  batch: FailedTest[],
  batchIndex: number,
  batchCount: number,
  totalFailures: number,
): string {
  if (isPerTestMode()) {
    return `${batchIndex + 1}/${totalFailures} — ${batch[0]?.testName ?? "unknown"}`;
  }
  return `${batchIndex + 1}/${batchCount} (${batch.length} tests)`;
}

async function buildFixPlanAll(
  ctx: StandardsContext,
  allFailures: FailedTest[],
  batches: FailedTest[][],
  tokenTracker: TokenTracker,
): Promise<FixPlanItem[]> {
  const merged: FixPlanItem[] = [];
  const covered = new Set<string>();

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const label = testLabel(batch, i, batches.length, allFailures.length);
    console.log(`  Fix plan ${label}…`);

    try {
      const { raw, tokenRecord } = await requestFixPlanBatch(
        ctx,
        batch,
        isPerTestMode() ? `fix-plan-test-${i + 1}` : `fix-plan-batch-${i + 1}`,
      );
      tokenTracker.record(tokenRecord);

      const parsed = FixPlanSchema.parse(JSON.parse(raw));
      for (const item of parsed.plan) {
        const failure = batch.find((f) => f.testName === item.testName) ?? batch[0];
        merged.push(failure ? applyDeterministicClassification(item, failure) : item);
        covered.add(item.testName);
      }
    } catch (err) {
      console.warn(`  Fix plan failed for ${label}, falling back to heuristic:`, err);
      for (const failure of batch) {
        const item = await requestSingleFixPlan(ctx, failure, tokenTracker, i + 1);
        if (item) {
          merged.push(item);
          covered.add(item.testName);
        }
      }
    }
  }

  const missing = allFailures.filter((f) => !covered.has(f.testName));
  if (missing.length > 0) {
    console.log(`  Filling ${missing.length} missing fix-plan entries individually…`);
    for (const failure of missing) {
      const item = await requestSingleFixPlan(
        ctx,
        failure,
        tokenTracker,
        allFailures.indexOf(failure) + 1,
      );
      if (item) merged.push(item);
    }
  }

  return merged;
}

async function requestSingleFixPlan(
  ctx: StandardsContext,
  failure: FailedTest,
  tokenTracker: TokenTracker,
  index: number,
): Promise<FixPlanItem | null> {
  try {
    const { raw, tokenRecord } = await requestFixPlanBatch(
      ctx,
      [failure],
      `fix-plan-single-${index}`,
    );
    tokenTracker.record(tokenRecord);
    const parsed = FixPlanSchema.parse(JSON.parse(raw));
    const item = parsed.plan[0];
    return item ? applyDeterministicClassification(item, failure) : null;
  } catch {
    return buildHeuristicFixPlanItem(failure);
  }
}

function buildHeuristicFixPlanItem(failure: FailedTest): FixPlanItem {
  const detected = classifyFailure(failure);
  if (detected) {
    return {
      testId: failure.testId,
      testName: failure.testName,
      category: detected.category,
      canAutoHeal: true,
      confidence: detected.confidence,
      rootCauseSummary: detected.rootCauseSummary,
      proposedChangeSummary: detected.proposedChangeSummary,
      codeChangeHints: detected.codeChangeHints,
    };
  }

  const err = failure.error.toLowerCase();
  let category: FixPlanItem["category"] = "backend-issue";
  let canAutoHeal = false;

  if (err.includes("timeout") || err.includes("waiting")) {
    category = "timing-flaky";
    canAutoHeal = true;
  } else if (err.includes("expect") || err.includes("assertion")) {
    category = "business-logic-change";
  }

  const rootLine =
    failure.errorSummary ??
    failure.error.split("\n")[0] ??
    failure.error;

  const loc = failure.failureLocation;
  const fileHint = loc?.file ?? failure.file ?? "tests/";

  return {
    testId: failure.testId,
    testName: failure.testName,
    category,
    canAutoHeal,
    confidence: 0.5,
    rootCauseSummary: rootLine.slice(0, 300),
    proposedChangeSummary: `Review ${fileHint} — inspect error-context and update page object or assertion.`,
    codeChangeHints: [
      {
        filePath: fileHint,
        reason: "Primary test or page object for this failure",
        suggestedSelectorOrChange: "See Playwright error-context.md",
      },
    ],
  };
}

async function buildAnalysisAll(
  ctx: StandardsContext,
  batches: FailedTest[][],
  stats: { passed: number; failed: number; skipped: number },
  fixPlanJson: string,
  tokenTracker: TokenTracker,
): Promise<string> {
  const sections: string[] = [];
  const totalFailures = batches.reduce((n, b) => n + b.length, 0);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const label = testLabel(batch, i, batches.length, totalFailures);
    console.log(`  Analysis ${label}…`);

    const { markdown, tokenRecord } = await requestAnalysisBatch(
      ctx,
      batch,
      label,
      stats,
      isPerTestMode() ? `analysis-test-${i + 1}` : `analysis-batch-${i + 1}`,
    ).catch((err) => ({
      markdown: `### Analysis error\n\n${String(err)}\n\n${batch.map((f) => `- **${f.testName}**: ${f.error.split("\n")[0]}`).join("\n")}`,
      tokenRecord: {
        label: `analysis-error-${i + 1}`,
        type: "analysis" as const,
        testName: batch[0]?.testName,
        estimatedInputTokens: 0,
        source: "estimated" as const,
      },
    }));
    tokenTracker.record(tokenRecord);

    if (isPerTestMode()) {
      sections.push(`## Test ${i + 1}/${totalFailures}\n\n${markdown}`);
    } else {
      sections.push(`## Batch ${label}\n\n${markdown}`);
    }
  }

  if (isPerTestMode() || sections.length <= 1) {
    return sections.join("\n\n");
  }

  console.log("  Synthesizing full analysis across all batches…");
  const synthesis = await requestSynthesisAnalysis({
    batchSections: sections,
    fixPlanJson,
  }).catch(() => ({
    markdown: sections.join("\n\n"),
    tokenRecord: {
      label: "synthesis-error",
      type: "synthesis" as const,
      estimatedInputTokens: 0,
      source: "estimated" as const,
    },
  }));
  tokenTracker.record(synthesis.tokenRecord);
  return synthesis.markdown;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
