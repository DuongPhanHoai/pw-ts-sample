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

export interface FailureLocation {
  file: string;
  line: number;
  column?: number;
}

export interface FailedTest extends TestCase {
  error: string;
  status: "failed" | "timedOut";
  /** Top-level Playwright message (often just "Test timeout exceeded"). */
  errorSummary?: string;
  /** Where the actionable failure occurred (page object / spec line). */
  failureLocation?: FailureLocation;
  /** Playwright call log excerpt, e.g. "waiting for locator('#pwd')". */
  callLog?: string;
  /** Contents of test-results/.../error-context.md when present. */
  errorContextMd?: string;
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

interface PlaywrightErrorEntry {
  message?: string;
  location?: {
    file?: string;
    line?: number;
    column?: number;
  };
}

interface PlaywrightAttachment {
  name?: string;
  contentType?: string;
  path?: string;
}

interface PlaywrightTestResult {
  status?: string;
  duration?: number;
  error?: { message?: string; stack?: string };
  errors?: PlaywrightErrorEntry[];
  attachments?: PlaywrightAttachment[];
}

interface PlaywrightSpec {
  id?: string;
  title?: string;
  file?: string;
  line?: number;
  tags?: string[];
  tests?: Array<{
    results?: PlaywrightTestResult[];
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

/** Remove ANSI color / style codes from Playwright JSON output. */
export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

/** Extract "Call log:" section from a Playwright error message. */
export function extractCallLog(message: string): string | undefined {
  const cleaned = stripAnsi(message);
  const match = cleaned.match(/Call log:\s*([\s\S]*?)(?:\n\n|$)/);
  if (!match) return undefined;
  const log = match[1]?.trim();
  return log || undefined;
}

function readErrorContextAttachment(attachments?: PlaywrightAttachment[]): string | undefined {
  const attachment = attachments?.find((a) => a.name === "error-context" && a.path);
  if (!attachment?.path || !fs.existsSync(attachment.path)) return undefined;
  try {
    return fs.readFileSync(attachment.path, "utf8");
  } catch {
    return undefined;
  }
}

function pickActionableError(errors?: PlaywrightErrorEntry[]): PlaywrightErrorEntry | undefined {
  if (!errors?.length) return undefined;
  return (
    errors.find((e) => e.location?.file && e.message && !isGenericTimeoutOnly(e.message)) ??
    errors.find((e) => e.location?.file) ??
    errors.find((e) => e.message && !isGenericTimeoutOnly(e.message)) ??
    errors[errors.length - 1]
  );
}

function isGenericTimeoutOnly(message: string): boolean {
  const cleaned = stripAnsi(message).trim();
  return /^Test timeout of \d+ms exceeded\.?$/.test(cleaned);
}

function buildEnrichedError(result: PlaywrightTestResult): {
  error: string;
  errorSummary?: string;
  failureLocation?: FailureLocation;
  callLog?: string;
  errorContextMd?: string;
} {
  const errorSummary = result.error?.message
    ? stripAnsi(result.error.message).trim()
    : undefined;

  const actionable = pickActionableError(result.errors);
  const actionableMessage = actionable?.message
    ? stripAnsi(actionable.message).trim()
    : undefined;
  const callLog = actionableMessage ? extractCallLog(actionableMessage) : undefined;

  const failureLocation =
    actionable?.location?.file && actionable.location.line
      ? {
          file: actionable.location.file,
          line: actionable.location.line,
          column: actionable.location.column,
        }
      : undefined;

  const errorContextMd = readErrorContextAttachment(result.attachments);

  const parts: string[] = [];
  if (errorSummary) parts.push(`Summary: ${errorSummary}`);
  if (actionableMessage && actionableMessage !== errorSummary) {
    parts.push(`Detail:\n${actionableMessage}`);
  }
  if (failureLocation) {
    parts.push(
      `Failure at: ${failureLocation.file}:${failureLocation.line}${failureLocation.column ? `:${failureLocation.column}` : ""}`,
    );
  }
  if (callLog) parts.push(`Call log:\n${callLog}`);
  if (errorContextMd) parts.push(`Error context (error-context.md):\n${errorContextMd}`);

  const error =
    parts.length > 0
      ? parts.join("\n\n")
      : (errorSummary ?? actionableMessage ?? "Unknown test failure");

  return { error, errorSummary, failureLocation, callLog, errorContextMd };
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

      const status = mapStatus(result.status);
      const enriched =
        status === "failed" || status === "timedOut"
          ? buildEnrichedError(result)
          : { error: undefined as string | undefined };

      out.push({
        testId: spec.id ?? testName,
        testName,
        file: spec.file ?? suite.file,
        line: spec.line,
        status,
        error: enriched.error,
        tags: spec.tags ?? [],
        durationMs: result.duration,
        ...(status === "failed" || status === "timedOut"
          ? {
              errorSummary: enriched.errorSummary,
              failureLocation: enriched.failureLocation,
              callLog: enriched.callLog,
              errorContextMd: enriched.errorContextMd,
            }
          : {}),
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
    (t): t is FailedTest =>
      (t.status === "failed" || t.status === "timedOut") && typeof t.error === "string",
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
