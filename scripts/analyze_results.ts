import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { chatText } from "./lib/llm";
import {
  normalizeDetailFields,
  normalizeTriageResult,
  renderTriageAnalysisMarkdown,
  resolveTriageGroups,
  type FailureTriageResult,
} from "./lib/failure-triage";
import {
  requestExecutiveSummary,
  requestFailureTriage,
  requestFixPlanForGroup,
  type StandardsContext,
} from "./lib/llm-batch";
import { getFailureLimit, shouldLogLlmToConsole } from "./lib/llm-log";
import { loadTestRun, type FailedTest } from "./lib/playwright-results";
import { paths, projectRoot } from "./lib/paths";
import {
  buildAiTestReport,
  renderAiTestReportMarkdown,
  type FixPlanItem,
} from "./lib/test-report";

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

type LlmPipelineStage = "triage" | "fix-plan" | "executive-summary" | "all-passed-summary";

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

function classifyLlmErrorReason(err: unknown): FixPlanBuildError["reason"] {
  if (err instanceof z.ZodError) return "schema_validation";
  if (err instanceof SyntaxError) return "invalid_json";
  if (err instanceof Error && err.message.includes("valid JSON")) return "invalid_json";
  return "llm_request_failed";
}

function writeLlmPipelineError(
  stage: LlmPipelineStage,
  err: unknown,
  extra?: Record<string, unknown>,
): void {
  fs.mkdirSync(path.dirname(paths.llmPipelineError), { recursive: true });
  fs.writeFileSync(
    paths.llmPipelineError,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        stage,
        reason: classifyLlmErrorReason(err),
        message: errMessage(err),
        ...extra,
      },
      null,
      2,
    ),
    "utf8",
  );
}

/** Log error and stop analyze — no fallback steps after an LLM failure. */
function abortAnalyze(stage: LlmPipelineStage, err: unknown, extra?: Record<string, unknown>): never {
  writeLlmPipelineError(stage, err, extra);
  console.error(`\nAnalyze stopped: LLM failed at ${stage}.`);
  console.error(`  ${errMessage(err)}`);
  console.error(`  See ${paths.llmPipelineError}`);
  process.exit(1);
}

async function main(): Promise<void> {
  fs.mkdirSync(path.dirname(paths.resultsJson), { recursive: true });

  const run = loadTestRun(paths.resultsJson);
  const testEnv = process.env.TEST_ENV ?? "test";
  const failureLimit = getFailureLimit();

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
    });
    aiSummary = result.content;
  } else {
    const ctx: StandardsContext = {
      uiStandards: fs.readFileSync(paths.uiStandards, "utf8"),
      evaluationCriteria: fs.readFileSync(paths.evaluationCriteria, "utf8"),
      autoHealPolicy: fs.readFileSync(paths.autoHealPolicy, "utf8"),
      projectRoot,
    };

    console.log(
      `Mode: two-phase analyze (1 triage call + fix group call(s) per triage group + summary)`,
    );

    console.log("  Step 1: triage failure summaries…");
    try {
      triageResult = await runTriageStep(ctx, failuresToAnalyze, stats);
    } catch (err) {
      abortAnalyze("triage", err, { failureCount: failuresToAnalyze.length });
    }
    fs.writeFileSync(paths.aiTriage, JSON.stringify(triageResult, null, 2), "utf8");

    console.log(`  Step 2: fix plan for ${triageResult.groups.length} group(s)…`);
    let fixPlanResult: { plan: FixPlanItem[]; planLlm: FixPlanItem[] };
    try {
      fixPlanResult = await buildFixPlanFromTriage(
        ctx,
        triageResult,
        failuresToAnalyze,
      );
    } catch (err) {
      const extra =
        err instanceof FixPlanGroupError
          ? { groupId: err.entry.groupId, fixPlanErrorsPath: paths.fixPlanErrors }
          : undefined;
      abortAnalyze("fix-plan", err, { triageGroupCount: triageResult.groups.length, ...extra });
    }
    fixPlan = fixPlanResult.plan;
    fixPlanLlm = fixPlanResult.planLlm;

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

    try {
      aiSummary = await requestExecutiveSummary({
        stats,
        testEnv,
        fixPlanJson,
        failureCount: failuresToAnalyze.length,
        perTestMode: false,
        fixPlanSource: "llm-step2",
      });
    } catch (err) {
      abortAnalyze("executive-summary", err, { fixGroupCount: fixPlan.length });
    }
  }

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
    const header = `# AI Test Analysis

Generated: ${new Date().toISOString()}
Failures analyzed: ${failuresToAnalyze.length}${failureLimit ? ` (limit ${failureLimit} of ${run.failures.length} total failures)` : ""}
Mode: two-phase (triage → selective detail fix plan)

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
          failureSnapshots: buildRepresentativeFailureSnapshots(triageResult, failuresToAnalyze),
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
    console.log(`Wrote ${paths.aiFixPlan}`);
  }
}

async function runTriageStep(
  ctx: StandardsContext,
  failures: FailedTest[],
  stats: { passed: number; failed: number; skipped: number },
): Promise<FailureTriageResult> {
  const triage = await requestFailureTriage(ctx, failures, stats);

  const parsed = TriageSchema.parse({
    ...triage,
    groups: triage.groups.map((g) => ({
      ...g,
      detailFieldsNeeded: normalizeDetailFields(g.detailFieldsNeeded),
    })),
  });
  return normalizeTriageResult(parsed, failures);
}

async function buildFixPlanFromTriage(
  ctx: StandardsContext,
  triage: FailureTriageResult,
  allFailures: FailedTest[],
): Promise<{ plan: FixPlanItem[]; planLlm: FixPlanItem[] }> {
  const resolvedGroups = resolveTriageGroups(triage, allFailures);
  const merged: FixPlanItem[] = [];
  const mergedLlm: FixPlanItem[] = [];

  for (let i = 0; i < resolvedGroups.length; i++) {
    const { group, representative, members } = resolvedGroups[i];
    const label = `${group.groupId} (${members.length} test(s))`;
    console.log(`    Fix plan ${i + 1}/${resolvedGroups.length}: ${label}…`);

    let raw: string | undefined;

    try {
      raw = await requestFixPlanForGroup(
        ctx,
        group,
        representative,
        `fix-plan-${group.groupId}`,
      );

      const parsed = FixPlanSchema.parse(JSON.parse(raw));
      const planItem = parsed.plan[0];

      if (!planItem) {
        failFixPlanGroup(
          group.groupId,
          representative,
          members.length,
          "empty_plan",
          "LLM returned valid JSON but plan[0] is missing or empty",
          raw,
          resolvedGroups.length,
        );
      }

      const llmItem = planItem;
      const item = planItem;

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
      if (err instanceof FixPlanGroupError) throw err;
      failFixPlanGroup(
        group.groupId,
        representative,
        members.length,
        classifyLlmErrorReason(err),
        errMessage(err),
        raw,
        resolvedGroups.length,
      );
    }
  }

  return { plan: merged, planLlm: mergedLlm };
}

class FixPlanGroupError extends Error {
  constructor(
    message: string,
    readonly entry: FixPlanBuildError,
    readonly expectedGroups: number,
  ) {
    super(message);
    this.name = "FixPlanGroupError";
  }
}

function failFixPlanGroup(
  groupId: string,
  representative: FailedTest,
  memberCount: number,
  reason: FixPlanBuildError["reason"],
  message: string,
  raw: string | undefined,
  expectedGroups: number,
): never {
  const entry: FixPlanBuildError = {
    groupId,
    representativeTestName: representative.testName,
    memberCount,
    stage: "fix-plan-llm",
    reason,
    message,
    rawResponsePreview: raw?.slice(0, 2000),
  };
  writeFixPlanErrors([entry], expectedGroups);
  console.error(`    Fix plan FAILED for ${groupId}: ${message}`);
  throw new FixPlanGroupError(`Fix plan LLM failed for ${groupId}: ${message}`, entry, expectedGroups);
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
