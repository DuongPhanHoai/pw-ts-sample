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
  /** Triage group id when this plan covers duplicate failures. */
  groupId?: string;
  /** All tests sharing this fix (includes representative). */
  memberTestNames?: string[];
  appliesToCount?: number;
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
  for (const plan of fixPlan) {
    for (const member of plan.memberTestNames ?? []) {
      if (!planByName.has(member)) planByName.set(member, plan);
    }
  }

  /** One row per fix action (representative); duplicates listed in memberTestNames. */
  const testsToFix = fixPlan.map((plan) => {
    const repFailure = run.failures.find((f) => f.testName === plan.testName);
    const members = plan.memberTestNames ?? [plan.testName];
    return {
      ...(repFailure ?? {
        testId: plan.testId,
        testName: plan.testName,
        file: plan.codeChangeHints[0]?.filePath,
        status: "failed" as const,
        error: plan.rootCauseSummary ?? plan.proposedChangeSummary,
      }),
      testName: plan.testName,
      category: plan.category,
      canAutoHeal: plan.canAutoHeal,
      proposedChangeSummary: plan.proposedChangeSummary,
      rootCauseSummary: plan.rootCauseSummary,
      groupId: plan.groupId,
      memberTestNames: members,
      appliesToCount: plan.appliesToCount ?? members.length,
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

  lines.push("## Fix actions", "");
  lines.push(
    "_One fix per root cause. Duplicate failures are grouped; see **Applies to** for affected tests._",
    "",
  );

  if (report.testsToFix.length === 0) {
    lines.push("_No failing tests — nothing to fix._", "");
  } else {
    lines.push(
      "| Representative test | Applies to | Category | Auto-heal? | Fix |",
      "|---------------------|------------|----------|------------|-----|",
    );
    for (const item of report.testsToFix) {
      const category = item.category ?? "—";
      const autoHeal =
        item.canAutoHeal === undefined ? "—" : item.canAutoHeal ? "Yes" : "No";
      const action = item.proposedChangeSummary ?? item.error;
      const appliesTo =
        "appliesToCount" in item && typeof item.appliesToCount === "number"
          ? `${item.appliesToCount} test(s)`
          : "1 test";
      lines.push(
        `| ${escapeCell(item.testName)} | ${appliesTo} | ${category} | ${autoHeal} | ${escapeCell(action)} |`,
      );
    }
    lines.push("");

    lines.push("### Fix details (representative only)", "");
    for (const item of report.testsToFix) {
      lines.push(`#### ${item.testName}`, "");
      if ("memberTestNames" in item && Array.isArray(item.memberTestNames) && item.memberTestNames.length > 1) {
        lines.push(`**Also fixes:** ${item.memberTestNames.length - 1} duplicate(s) with the same root cause.`, "");
      }
      if (item.rootCauseSummary) {
        lines.push(`**Root cause:** ${item.rootCauseSummary}`, "");
      }
      lines.push("```", item.error, "```", "");
    }
  }

  lines.push("## All failed tests", "");
  if (report.failedTests.length === 0) {
    lines.push("_None._", "");
  } else {
    for (const test of report.failedTests) {
      const file = test.file ? ` (\`${test.file}\`)` : "";
      lines.push(`- ${test.testName}${file}`);
    }
    lines.push("");
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
      "1. Review **Fix actions** above.",
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
