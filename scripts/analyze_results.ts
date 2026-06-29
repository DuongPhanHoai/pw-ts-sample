import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { chatJson, chatText } from "./lib/llm";
import { loadTestRun } from "./lib/playwright-results";
import { paths, projectRoot } from "./lib/paths";
import {
  buildAiTestReport,
  renderAiTestReportMarkdown,
  type FixPlanItem,
} from "./lib/test-report";

const FixPlanSchema = z.object({
  plan: z.array(
    z.object({
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
    }),
  ),
});

async function main(): Promise<void> {
  fs.mkdirSync(path.dirname(paths.resultsJson), { recursive: true });

  const run = loadTestRun(paths.resultsJson);
  const testEnv = process.env.TEST_ENV ?? "test";

  console.log(
    `Results: ${run.passed} passed, ${run.failed} failed, ${run.skipped} skipped`,
  );

  let fixPlan: FixPlanItem[] = [];
  let aiAnalysis = "";
  let aiSummary = "";

  if (run.failures.length === 0) {
    aiSummary = await chatText(
      "You are a QA lead. Write 2-3 sentences in plain English.",
      `All Playwright tests passed.
Environment: TEST_ENV=${testEnv}
Passed: ${run.passed}, Failed: 0, Skipped: ${run.skipped}
Test names: ${run.tests.map((t) => t.testName).join("; ")}
Confirm success and note no fixes are needed.`,
    ).catch(() => "All tests passed. No failures detected. No fixes required.");
  } else {
    const uiStandards = fs.readFileSync(paths.uiStandards, "utf8");
    const evaluationCriteria = fs.readFileSync(paths.evaluationCriteria, "utf8");
    const autoHealPolicy = fs.readFileSync(paths.autoHealPolicy, "utf8");

    aiAnalysis = await chatText(
      "You are an expert test result analyst. Write clear markdown for engineers.",
      buildAnalysisPrompt({
        uiStandards,
        evaluationCriteria,
        autoHealPolicy,
        failures: run.failures,
        stats: {
          passed: run.passed,
          failed: run.failed,
          skipped: run.skipped,
        },
      }),
    );

    const planRaw = await chatJson(
      `You are an expert test result analyst. Follow testing standards and auto-heal policy.
Return ONLY valid JSON with shape:
{
  "plan": [{
    "testId": "string",
    "testName": "string",
    "category": "locators-broken|timing-flaky|backend-issue|business-logic-change|test-data-issue",
    "canAutoHeal": boolean,
    "confidence": 0.0-1.0,
    "rootCauseSummary": "string",
    "proposedChangeSummary": "string",
    "codeChangeHints": [{ "filePath": "string", "reason": "string", "suggestedSelectorOrChange": "string" }]
  }]
}
Set canAutoHeal false when policy.categories[category].autoHeal is false.`,
      buildPlanPrompt({
        uiStandards,
        evaluationCriteria,
        autoHealPolicy,
        failures: run.failures,
      }),
    );

    fixPlan = FixPlanSchema.parse(JSON.parse(planRaw)).plan;

    aiSummary = await chatText(
      "You are a QA lead. Write 2-4 sentences summarizing what must be fixed.",
      `Failed tests: ${run.failures.length}. Fix plan: ${JSON.stringify(fixPlan, null, 2)}
State clearly which tests need fixing and whether auto-heal may help.`,
    ).catch(
      () =>
        `${run.failed} test(s) failed and need review. See Tests to fix section for details.`,
    );
  }

  const report = buildAiTestReport({ run, fixPlan, aiSummary });
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
    const header = `# AI Test Analysis\n\nGenerated: ${new Date().toISOString()}\n\n`;
    fs.writeFileSync(paths.aiAnalysis, header + aiAnalysis, "utf8");
    fs.writeFileSync(
      paths.aiFixPlan,
      JSON.stringify({ generatedAt: new Date().toISOString(), plan: fixPlan }, null, 2),
      "utf8",
    );
  }

  console.log(`Wrote ${paths.aiTestReport}`);
  console.log(`Wrote ${paths.aiTestReportJson}`);
  console.log(`Status: ${report.overallStatus.toUpperCase()} — ${report.headline}`);
  if (run.failures.length > 0) {
    console.log(`Wrote ${paths.aiAnalysis}`);
    console.log(`Wrote ${paths.aiFixPlan} (${fixPlan.length} items)`);
  }
}

function buildAnalysisPrompt(input: {
  uiStandards: string;
  evaluationCriteria: string;
  autoHealPolicy: string;
  failures: unknown[];
  stats: { passed: number; failed: number; skipped: number };
}): string {
  return `Summarize Playwright failures for engineers.

Stats: ${JSON.stringify(input.stats)}

## Testing standards
${input.uiStandards}

## Evaluation criteria
${input.evaluationCriteria}

## Auto-heal policy
${input.autoHealPolicy}

## Failed tests (JSON)
${JSON.stringify(input.failures, null, 2)}

Write markdown with:
1. Executive summary
2. Failures grouped by recommended category
3. Recommended next actions (retry, fix-test, fix-app, investigate)
4. Which failures may be auto-healed per policy`;
}

function buildPlanPrompt(input: {
  uiStandards: string;
  evaluationCriteria: string;
  autoHealPolicy: string;
  failures: unknown[];
}): string {
  return `1. Testing standards (markdown):
${input.uiStandards}

2. Evaluation criteria (markdown):
${input.evaluationCriteria}

3. Auto-heal policy (JSON):
${input.autoHealPolicy}

4. Playwright failed tests (JSON):
${JSON.stringify(input.failures, null, 2)}

For each failed test assign a category, rootCauseSummary, canAutoHeal per policy, and codeChangeHints with paths under ${projectRoot.replace(/\\/g, "/")}.`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
