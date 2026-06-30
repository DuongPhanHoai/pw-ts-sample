import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { chatText } from "./lib/llm";
import {
  buildDeterministicTriage,
  normalizeDetailFields,
  normalizeTriageResult,
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
import { applyDeterministicClassification } from "./lib/failure-classifier";
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
  groupId: z.string().optional(),
  memberTestNames: z.array(z.string()).optional(),
  appliesToCount: z.number().optional(),
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

type FixPlanBuildError = {
  groupId: string;
  representativeTestName: string;
  memberCount: number;
  stage: "fix-plan-llm";
  reason: "llm_request_failed" | "invalid_json" | "schema_validation" | "empty_plan";
  message: string;
  rawResponsePreview?: string;
};

function errMessage(err: unknown): string {
  if (err instanceof z.ZodError) {
    return err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  }
  return err instanceof Error ? err.message : String(err);
}

function classifyFixPlanError(err: unknown): FixPlanBuildError["reason"] {
  if (err instanceof z.ZodError) return "schema_validation";
  if (err instanceof SyntaxError) return "invalid_json";
  return "llm_request_failed";
}

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
  let fixPlanLlm: FixPlanItem[] = [];
  let fixPlanErrors: FixPlanBuildError[] = [];
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
    const fixPlanResult = await buildFixPlanFromTriage(
      ctx,
      triageResult,
      failuresToAnalyze,
      tokenTracker,
    );
    fixPlan = fixPlanResult.plan;
    fixPlanLlm = fixPlanResult.planLlm;
    fixPlanErrors = fixPlanResult.errors;

    writeFixPlanErrors(fixPlanErrors, triageResult.groups.length);

    if (fixPlanErrors.length > 0) {
      console.error(
        `\nFix plan incomplete: ${fixPlanErrors.length} group(s) failed LLM fix-plan ` +
          `(expected ${triageResult.groups.length}, got ${fixPlan.length}). ` +
          `See ${paths.fixPlanErrors}`,
      );
    }

    const execPlanPayload = fixPlanLlm.map((p) => ({
      groupId: p.groupId,
      representativeTestName: p.testName,
      appliesToCount: p.appliesToCount ?? p.memberTestNames?.length ?? 1,
      memberTestNames: p.memberTestNames,
      category: p.category,
      canAutoHeal: p.canAutoHeal,
      proposedChangeSummary: p.proposedChangeSummary,
      codeChangeHints: p.codeChangeHints,
    }));
    const fixPlanJson = JSON.stringify({ plan: execPlanPayload }, null, 2);
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
      fixPlanSource: "llm-step2",
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
          fixGroupCount: fixPlan.length,
          mode: "two-phase",
          triage: triageResult,
          tokenSummary: tokenTracker.summary(),
          failureSnapshots: buildRepresentativeFailureSnapshots(triageResult, failuresToAnalyze),
          fixPlanErrors,
          planLlm: fixPlanLlm,
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
    console.log(`Fix plan: ${fixPlan.length} group(s) covering ${failuresToAnalyze.length} failure(s)`);
    if (fixPlanErrors.length > 0) {
      console.error(`Fix plan errors: ${fixPlanErrors.length} — ${paths.fixPlanErrors}`);
    }
    console.log(`Wrote ${paths.aiFixPlan}`);
    console.log(`Wrote ${tokenReportPath}`);
    console.log(formatTokenSummary(tokenTracker.summary()));
    if (fixPlanErrors.length > 0) {
      process.exit(1);
    }
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
    return normalizeTriageResult(parsed, failures);
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
): Promise<{ plan: FixPlanItem[]; planLlm: FixPlanItem[]; errors: FixPlanBuildError[] }> {
  const resolvedGroups = resolveTriageGroups(triage, allFailures);
  const merged: FixPlanItem[] = [];
  const mergedLlm: FixPlanItem[] = [];
  const errors: FixPlanBuildError[] = [];

  for (let i = 0; i < resolvedGroups.length; i++) {
    const { group, representative, members } = resolvedGroups[i];
    const label = `${group.groupId} (${members.length} test(s))`;
    console.log(`    Fix plan ${i + 1}/${resolvedGroups.length}: ${label}…`);

    let raw: string | undefined;

    try {
      const result = await requestFixPlanForGroup(
        ctx,
        group,
        representative,
        `fix-plan-${group.groupId}`,
      );
      tokenTracker.record(result.tokenRecord);
      raw = result.raw;

      const parsed = FixPlanSchema.parse(JSON.parse(raw));
      const planItem = parsed.plan[0];

      if (!planItem) {
        const entry: FixPlanBuildError = {
          groupId: group.groupId,
          representativeTestName: representative.testName,
          memberCount: members.length,
          stage: "fix-plan-llm",
          reason: "empty_plan",
          message: "LLM returned valid JSON but plan[0] is missing or empty",
          rawResponsePreview: raw.slice(0, 2000),
        };
        errors.push(entry);
        console.error(`    Fix plan FAILED for ${group.groupId}: ${entry.message}`);
        continue;
      }

      const llmItem = planItem;
      const item = applyDeterministicClassification(planItem, representative);
      if (item.proposedChangeSummary !== planItem.proposedChangeSummary) {
        console.warn(
          `    Classifier adjusted LLM fix (group ${group.groupId}):\n` +
            `      LLM:         ${planItem.proposedChangeSummary}\n` +
            `      Classifier:  ${item.proposedChangeSummary}`,
        );
      }

      const memberNames = members.map((m) => m.testName);
      merged.push({
        ...item,
        testId: representative.testId,
        testName: representative.testName,
        groupId: group.groupId,
        memberTestNames: memberNames,
        appliesToCount: memberNames.length,
        rootCauseSummary: item.rootCauseSummary ?? group.triageSummary,
      });
      mergedLlm.push({
        ...llmItem,
        testId: representative.testId,
        testName: representative.testName,
        groupId: group.groupId,
        memberTestNames: memberNames,
        appliesToCount: memberNames.length,
        rootCauseSummary: llmItem.rootCauseSummary ?? group.triageSummary,
      });
    } catch (err) {
      const entry: FixPlanBuildError = {
        groupId: group.groupId,
        representativeTestName: representative.testName,
        memberCount: members.length,
        stage: "fix-plan-llm",
        reason: classifyFixPlanError(err),
        message: errMessage(err),
        rawResponsePreview: raw?.slice(0, 2000),
      };
      errors.push(entry);
      console.error(`    Fix plan FAILED for ${group.groupId}: ${entry.message}`);
    }
  }

  return { plan: merged, planLlm: mergedLlm, errors };
}

function writeFixPlanErrors(errors: FixPlanBuildError[], expectedGroups: number): void {
  fs.mkdirSync(path.dirname(paths.fixPlanErrors), { recursive: true });
  fs.writeFileSync(
    paths.fixPlanErrors,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        expectedGroups,
        successCount: expectedGroups - errors.length,
        failureCount: errors.length,
        errors,
      },
      null,
      2,
    ),
    "utf8",
  );
}

function snapshotFailure(f: FailedTest) {
  return {
    testName: f.testName,
    error: f.error,
    errorSummary: f.errorSummary,
    callLog: f.callLog,
    failureLocation: f.failureLocation,
    errorContextMd: f.errorContextMd,
    pageEvidence: f.pageEvidence,
    file: f.file,
  };
}

function buildRepresentativeFailureSnapshots(
  triage: FailureTriageResult,
  failures: FailedTest[],
): Record<string, ReturnType<typeof snapshotFailure>> {
  const byName = new Map(failures.map((f) => [f.testName, f]));
  const out: Record<string, ReturnType<typeof snapshotFailure>> = {};
  for (const group of triage.groups) {
    const rep = byName.get(group.representativeTestName);
    if (rep) out[rep.testName] = snapshotFailure(rep);
  }
  return out;
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
      lines.push("- **Fix:** (LLM fix-plan failed — see reports/fix-plan-errors.json)");
    }
    lines.push("");
  }

  return lines.join("\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
