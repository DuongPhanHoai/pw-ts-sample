import type { FailedTest, TestCase } from "./playwright-results";

export interface TestRunData {
  tests: TestCase[];
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  failures: FailedTest[];
}

export interface FixPlanItem {
  testId: string;
  testName: string;
  category: string;
  canAutoHeal: boolean;
  confidence?: number;
  rootCauseSummary?: string;
  proposedChangeSummary: string;
  codeChangeHints: Array<{
    filePath: string;
    reason: string;
    suggestedSelectorOrChange: string;
  }>;
}

export interface AiTestReport {
  generatedAt: string;
  overallStatus: "pass" | "fail";
  headline: string;
  testEnv: string;
  summary: {
    passed: number;
    failed: number;
    skipped: number;
    flaky: number;
    total: number;
  };
  aiSummary?: string;
  testsToFix: Array<
    FailedTest & {
      category?: string;
      canAutoHeal?: boolean;
      proposedChangeSummary?: string;
      rootCauseSummary?: string;
    }
  >;
  passedTests: TestCase[];
  failedTests: FailedTest[];
  fixPlan: FixPlanItem[];
}

export function buildAiTestReport(input: {
  run: TestRunData;
  fixPlan?: FixPlanItem[];
  aiSummary?: string;
}): AiTestReport {
  const { run, fixPlan = [], aiSummary } = input;
  const total = run.tests.length;
  const overallStatus = run.failed > 0 ? "fail" : "pass";
  const headline =
    overallStatus === "pass"
      ? `All ${run.passed} tests passed`
      : `${run.failed} test(s) need fixing`;

  const planByName = new Map(fixPlan.map((p) => [p.testName, p]));

  const testsToFix = run.failures.map((failure) => {
    const plan = planByName.get(failure.testName);
    return {
      ...failure,
      category: plan?.category,
      canAutoHeal: plan?.canAutoHeal,
      proposedChangeSummary: plan?.proposedChangeSummary,
      rootCauseSummary: plan?.rootCauseSummary ?? failure.error,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    overallStatus,
    headline,
    testEnv: process.env.TEST_ENV ?? "test",
    summary: {
      passed: run.passed,
      failed: run.failed,
      skipped: run.skipped,
      flaky: run.flaky,
      total,
    },
    aiSummary,
    testsToFix,
    passedTests: run.tests.filter((t) => t.status === "passed"),
    failedTests: run.failures,
    fixPlan,
  };
}

export function renderAiTestReportMarkdown(report: AiTestReport): string {
  const statusIcon = report.overallStatus === "pass" ? "PASS" : "FAIL";
  const statusLabel =
    report.overallStatus === "pass" ? "All tests passed" : "Tests need fixes";

  const lines: string[] = [
    "# AI Test Report",
    "",
    `> **Status: ${statusIcon}** — ${statusLabel}`,
    "",
    `**Headline:** ${report.headline}`,
    "",
    `**Generated:** ${report.generatedAt}`,
    "",
    `**Environment:** \`TEST_ENV=${report.testEnv}\``,
    "",
    "## Summary",
    "",
    "| Passed | Failed | Skipped | Flaky | Total |",
    "|--------|--------|---------|-------|-------|",
    `| ${report.summary.passed} | ${report.summary.failed} | ${report.summary.skipped} | ${report.summary.flaky} | ${report.summary.total} |`,
    "",
  ];

  if (report.aiSummary?.trim()) {
    lines.push("## AI Summary", "", report.aiSummary.trim(), "");
  }

  lines.push("## Tests to fix", "");

  if (report.testsToFix.length === 0) {
    lines.push("_No failing tests — nothing to fix._", "");
  } else {
    lines.push(
      "| Test | File | Category | Auto-heal? | Action |",
      "|------|------|----------|------------|--------|",
    );
    for (const item of report.testsToFix) {
      const file = item.file ? `\`${item.file}\`` : "—";
      const category = item.category ?? "—";
      const autoHeal =
        item.canAutoHeal === undefined ? "—" : item.canAutoHeal ? "Yes" : "No";
      const action = item.proposedChangeSummary ?? item.error;
      lines.push(
        `| ${escapeCell(item.testName)} | ${file} | ${category} | ${autoHeal} | ${escapeCell(action)} |`,
      );
    }
    lines.push("");

    lines.push("### Failure details", "");
    for (const item of report.testsToFix) {
      lines.push(`#### ${item.testName}`, "");
      if (item.rootCauseSummary) {
        lines.push(`**Root cause:** ${item.rootCauseSummary}`, "");
      }
      lines.push("```", item.error, "```", "");
    }
  }

  lines.push("## Passed tests", "");

  if (report.passedTests.length === 0) {
    lines.push("_None._", "");
  } else {
    for (const test of report.passedTests) {
      const file = test.file ? ` (\`${test.file}\`)` : "";
      lines.push(`- ${test.testName}${file}`);
    }
    lines.push("");
  }

  if (report.overallStatus === "pass") {
    lines.push("## Recommendation", "", "No action required. Safe to merge or continue.", "");
  } else {
    lines.push(
      "## Recommendation",
      "",
      "1. Review **Tests to fix** above.",
      "2. Run `npm run apply:ai-fixes` with `AUTO_FIX_TESTS=dry-run` for suggested patches.",
      "3. Re-run: `npx playwright test --last-failed`",
      "",
    );
  }

  return lines.join("\n");
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
