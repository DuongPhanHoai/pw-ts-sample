import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { chatText } from "./lib/llm";
import {
  buildDeterministicTriage,
  normalizeDetailFields,
  renderTriageAnalysisMarkdown,
  resolveTriageGroups,
  type FailureTriageResult,
} from "./lib/failure-triage";
import {
  estimateTwoPhaseInputTokens,
  requestExecutiveSummary,
  requestFailureTriage,
  requestFixPlanForGroup,
  type StandardsContext,
} from "./lib/llm-batch";
import { applyDeterministicClassification, classifyFailure } from "./lib/failure-classifier";
import { getFailureLimit, shouldLogLlmToConsole } from "./lib/llm-log";
import { loadTestRun, type FailedTest } from "./lib/playwright-results";
import { paths, projectRoot } from "./lib/paths";
import {
  buildAiTestReport,
  renderAiTestReportMarkdown,
  type FixPlanItem,
} from "./lib/test-report";
import { formatTokenSummary } from "./lib/token-estimate";
import { TokenTracker } from "./lib/token-tracker";

const DetailFieldSchema = z.enum([
  "errorDetail",
  "errorContextMd",
  "pageEvidence",
  "pageEvidenceCssOnly",
  "pageEvidenceDomOnly",
]);

const TriageGroupSchema = z.object({
  groupId: z.string(),
  representativeTestName: z.string(),
  memberTestNames: z.array(z.string()).min(1),
  likelyCategory: z
    .enum([
      "locators-broken",
      "timing-flaky",
      "backend-issue",
      "business-logic-change",
      "test-data-issue",
    ])
    .optional(),
  triageSummary: z.string(),
  detailFieldsNeeded: z.array(DetailFieldSchema).min(1),
  duplicateReason: z.string().optional(),
});

const TriageSchema = z.object({
  groups: z.array(TriageGroupSchema).min(1),
  notes: z.string().optional(),
});

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
  if (shouldLogLlmToConsole()) {
    console.log("LMSTUDIO_LOG_PROMPTS=true — full payloads also printed to console");
  }

  let fixPlan: FixPlanItem[] = [];
  let aiAnalysis = "";
  let aiSummary = "";
  let triageResult: FailureTriageResult | undefined;

  if (run.failures.length === 0) {
    const system = "You are a QA lead. Write 2-3 sentences in plain English.";
    const user = `All Playwright tests passed.
Environment: TEST_ENV=${testEnv}
Passed: ${run.passed}, Failed: 0, Skipped: ${run.skipped}
Confirm success and note no fixes are needed.`;
    const result = await chatText(system, user, {
      label: "all-passed-summary",
      meta: { type: "all-passed-summary" },
    }).catch(() => ({
      content: "All tests passed. No failures detected. No fixes required.",
    }));
    aiSummary = result.content;
  } else {
    const ctx: StandardsContext = {
      uiStandards: fs.readFileSync(paths.uiStandards, "utf8"),
      evaluationCriteria: fs.readFileSync(paths.evaluationCriteria, "utf8"),
      autoHealPolicy: fs.readFileSync(paths.autoHealPolicy, "utf8"),
      projectRoot,
    };

    const preEstimate = estimateTwoPhaseInputTokens(ctx, failuresToAnalyze, stats);
    console.log(
      `Mode: two-phase analyze (1 triage call + ${preEstimate.estimatedGroupCount} fix group call(s) + summary)`,
    );
    console.log(
      `Token pre-estimate: ~${preEstimate.totalInputTokens.toLocaleString()} input + ~${preEstimate.estimatedOutputTokens.toLocaleString()} output ≈ ~${preEstimate.estimatedTotalTokens.toLocaleString()} total`,
    );

    console.log("  Step 1: triage failure summaries…");
    triageResult = await runTriageStep(ctx, failuresToAnalyze, stats, tokenTracker);
    fs.writeFileSync(paths.aiTriage, JSON.stringify(triageResult, null, 2), "utf8");

    console.log(`  Step 2: fix plan for ${triageResult.groups.length} group(s)…`);
    fixPlan = await buildFixPlanFromTriage(ctx, triageResult, failuresToAnalyze, tokenTracker);

    const fixPlanJson = JSON.stringify({ plan: fixPlan }, null, 2);
    aiAnalysis = buildTwoPhaseAnalysisMarkdown(
      triageResult,
      fixPlan,
      failuresToAnalyze.length,
    );

    const execResult = await requestExecutiveSummary({
      stats,
      testEnv,
      fixPlanJson,
      failureCount: failuresToAnalyze.length,
      perTestMode: false,
    }).catch(() => ({
      summary: `${run.failed} test(s) failed. See ai-analysis.md for triage and fix suggestions.`,
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
    const tokenBlock = formatTokenSummary(tokenTracker.summary());
    const header = `# AI Test Analysis

Generated: ${new Date().toISOString()}
Failures analyzed: ${failuresToAnalyze.length}${failureLimit ? ` (limit ${failureLimit} of ${run.failures.length} total failures)` : ""}
Mode: two-phase (triage → selective detail fix plan)

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
          mode: "two-phase",
          triage: triageResult,
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
    console.log(`Wrote ${paths.aiTriage}`);
    console.log(`Fix plan coverage: ${fixPlan.length}/${failuresToAnalyze.length} tests`);
    console.log(`Wrote ${paths.aiFixPlan}`);
    console.log(`Wrote ${tokenReportPath}`);
    console.log(formatTokenSummary(tokenTracker.summary()));
  }
}

async function runTriageStep(
  ctx: StandardsContext,
  failures: FailedTest[],
  stats: { passed: number; failed: number; skipped: number },
  tokenTracker: TokenTracker,
): Promise<FailureTriageResult> {
  try {
    const { triage, tokenRecord } = await requestFailureTriage(ctx, failures, stats);
    tokenTracker.record(tokenRecord);

    const parsed = TriageSchema.parse({
      ...triage,
      groups: triage.groups.map((g) => ({
        ...g,
        detailFieldsNeeded: normalizeDetailFields(g.detailFieldsNeeded),
      })),
    });
    return parsed;
  } catch (err) {
    console.warn("  Triage LLM failed, using deterministic grouping:", err);
    return buildDeterministicTriage(failures);
  }
}

async function buildFixPlanFromTriage(
  ctx: StandardsContext,
  triage: FailureTriageResult,
  allFailures: FailedTest[],
  tokenTracker: TokenTracker,
): Promise<FixPlanItem[]> {
  const resolvedGroups = resolveTriageGroups(triage, allFailures);
  const merged: FixPlanItem[] = [];

  for (let i = 0; i < resolvedGroups.length; i++) {
    const { group, representative, members } = resolvedGroups[i];
    const label = `${group.groupId} (${members.length} test(s))`;
    console.log(`    Fix plan ${i + 1}/${resolvedGroups.length}: ${label}…`);

    let item: FixPlanItem | null = null;

    try {
      const { raw, tokenRecord } = await requestFixPlanForGroup(
        ctx,
        group,
        representative,
        `fix-plan-${group.groupId}`,
      );
      tokenTracker.record(tokenRecord);
      const parsed = FixPlanSchema.parse(JSON.parse(raw));
      const planItem = parsed.plan[0];
      item = planItem ? applyDeterministicClassification(planItem, representative) : null;
    } catch (err) {
      console.warn(`    Fix plan failed for ${group.groupId}, using heuristic:`, err);
      item = buildHeuristicFixPlanItem(representative);
    }

    if (!item) continue;

    for (const member of members) {
      merged.push({
        ...item,
        testId: member.testId,
        testName: member.testName,
        rootCauseSummary: item.rootCauseSummary ?? group.triageSummary,
      });
    }
  }

  return merged;
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
    failure.errorSummary ?? failure.error.split("\n")[0] ?? failure.error;
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

function buildTwoPhaseAnalysisMarkdown(
  triage: FailureTriageResult,
  fixPlan: FixPlanItem[],
  failureCount: number,
): string {
  const planByName = new Map(fixPlan.map((p) => [p.testName, p]));
  const lines = [
    renderTriageAnalysisMarkdown(triage, triage.groups.length, failureCount),
    "## Step 2 — Fix suggestions",
    "",
  ];

  for (const group of triage.groups) {
    const repPlan = planByName.get(group.representativeTestName);
    lines.push(`### ${group.groupId}: ${group.representativeTestName}`);
    lines.push(`- **Applies to:** ${group.memberTestNames.length} test(s)`);
    if (group.detailFieldsNeeded.length > 0) {
      lines.push(`- **Detail used:** ${group.detailFieldsNeeded.join(", ")}`);
    }

    if (repPlan) {
      lines.push(`- **Category:** ${repPlan.category}`);
      lines.push(`- **Can auto-heal:** ${repPlan.canAutoHeal ? "yes" : "no"}`);
      if (repPlan.rootCauseSummary) lines.push(`- **Root cause:** ${repPlan.rootCauseSummary}`);
      lines.push(`- **Fix:** ${repPlan.proposedChangeSummary}`);
      if (repPlan.codeChangeHints.length > 0) {
        lines.push("- **Hints:**");
        for (const hint of repPlan.codeChangeHints) {
          lines.push(`  - \`${hint.filePath}\`: ${hint.suggestedSelectorOrChange}`);
        }
      }
    } else {
      lines.push("- **Fix:** (no plan generated for representative)");
    }
    lines.push("");
  }

  return lines.join("\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
