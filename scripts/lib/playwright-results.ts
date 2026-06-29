import fs from "node:fs";

export type TestStatus = "passed" | "failed" | "timedOut" | "skipped" | "flaky" | "interrupted";

export interface TestCase {
  testId: string;
  testName: string;
  file?: string;
  line?: number;
  status: TestStatus;
  error?: string;
  tags: string[];
  durationMs?: number;
}

export interface FailedTest extends TestCase {
  error: string;
  status: "failed" | "timedOut";
}

interface PlaywrightJsonReport {
  suites?: PlaywrightSuite[];
  stats?: {
    expected?: number;
    unexpected?: number;
    skipped?: number;
    flaky?: number;
  };
}

interface PlaywrightSuite {
  title?: string;
  file?: string;
  specs?: PlaywrightSpec[];
  suites?: PlaywrightSuite[];
}

interface PlaywrightSpec {
  id?: string;
  title?: string;
  file?: string;
  line?: number;
  tags?: string[];
  tests?: Array<{
    results?: Array<{
      status?: string;
      duration?: number;
      error?: { message?: string };
    }>;
  }>;
}

function mapStatus(raw?: string): TestStatus {
  switch (raw) {
    case "passed":
      return "passed";
    case "failed":
      return "failed";
    case "timedOut":
      return "timedOut";
    case "skipped":
      return "skipped";
    case "flaky":
      return "flaky";
    case "interrupted":
      return "interrupted";
    default:
      return "failed";
  }
}

function collectTests(
  suite: PlaywrightSuite,
  parentTitle: string,
  out: TestCase[],
): void {
  const suiteTitle = [parentTitle, suite.title].filter(Boolean).join(" > ");

  for (const spec of suite.specs ?? []) {
    const testName = [suiteTitle, spec.title].filter(Boolean).join(" > ");
    for (const test of spec.tests ?? []) {
      const result = test.results?.[test.results.length - 1];
      if (!result?.status) continue;

      out.push({
        testId: spec.id ?? testName,
        testName,
        file: spec.file ?? suite.file,
        line: spec.line,
        status: mapStatus(result.status),
        error: result.error?.message,
        tags: spec.tags ?? [],
        durationMs: result.duration,
      });
    }
  }

  for (const child of suite.suites ?? []) {
    collectTests(child, suiteTitle, out);
  }
}

export function loadTestRun(reportPath: string): {
  tests: TestCase[];
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  failures: FailedTest[];
} {
  if (!fs.existsSync(reportPath)) {
    throw new Error(`Playwright report not found: ${reportPath}`);
  }

  const raw = JSON.parse(fs.readFileSync(reportPath, "utf8")) as PlaywrightJsonReport;
  const tests: TestCase[] = [];

  for (const suite of raw.suites ?? []) {
    collectTests(suite, "", tests);
  }

  const failures = tests.filter(
    (t): t is FailedTest => t.status === "failed" || t.status === "timedOut",
  );

  return {
    tests,
    passed: raw.stats?.expected ?? tests.filter((t) => t.status === "passed").length,
    failed: raw.stats?.unexpected ?? failures.length,
    skipped: raw.stats?.skipped ?? tests.filter((t) => t.status === "skipped").length,
    flaky: raw.stats?.flaky ?? tests.filter((t) => t.status === "flaky").length,
    failures,
  };
}

/** @deprecated use loadTestRun */
export function loadFailedTests(reportPath: string) {
  const run = loadTestRun(reportPath);
  return {
    failures: run.failures,
    passed: run.passed,
    failed: run.failed,
    skipped: run.skipped,
  };
}
