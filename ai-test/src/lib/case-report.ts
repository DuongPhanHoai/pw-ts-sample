import fs from "node:fs";
import path from "node:path";
import { buildPageEvidence } from "../../../scripts/lib/page-evidence";
import type { PageEvidence } from "../../../scripts/lib/page-evidence";

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
  errorSummary?: string;
  failureLocation?: FailureLocation;
  callLog?: string;
  errorContextMd?: string;
  pageEvidence?: PageEvidence;
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
  body?: string;
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
  tests?: Array<{ results?: PlaywrightTestResult[] }>;
}

/** Map Playwright attachment names to files stored alongside results.json in the case folder. */
const CASE_ATTACHMENT_FILES: Record<string, string> = {
  "page-html": "page-html.html",
  "page-css": "page-css.css",
  "error-context": "error-context.md",
};

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

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

function extractCallLog(message: string): string | undefined {
  const cleaned = stripAnsi(message);
  const match = cleaned.match(/Call log:\s*([\s\S]*?)(?:\n\n|$)/);
  if (!match) return undefined;
  const log = match[1]?.trim();
  return log || undefined;
}

function readAttachmentText(
  attachments: PlaywrightAttachment[] | undefined,
  name: string,
): string | undefined {
  const attachment = attachments?.find((a) => a.name === name);
  if (!attachment) return undefined;

  if (attachment.path && fs.existsSync(attachment.path)) {
    try {
      return fs.readFileSync(attachment.path, "utf8");
    } catch {
      return undefined;
    }
  }

  if (attachment.body) {
    try {
      return Buffer.from(attachment.body, "base64").toString("utf8");
    } catch {
      return undefined;
    }
  }

  return undefined;
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
  pageEvidence?: PageEvidence;
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

  const errorContextMd = readAttachmentText(result.attachments, "error-context");
  const pageHtml = readAttachmentText(result.attachments, "page-html");
  const pageCss = readAttachmentText(result.attachments, "page-css");

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

  const pageEvidence = buildPageEvidence(pageHtml, pageCss, undefined);

  return {
    error,
    errorSummary,
    failureLocation,
    callLog,
    errorContextMd,
    pageEvidence,
  };
}

function collectTests(suite: PlaywrightSuite, parentTitle: string, out: TestCase[]): void {
  const suiteTitle = [parentTitle, suite.title].filter(Boolean).join(" > ");

  for (const spec of suite.specs ?? []) {
    const testName = [suiteTitle, spec.title].filter(Boolean).join(" > ");
    for (const test of spec.tests ?? []) {
      const result = test.results?.[test.results.length - 1];
      if (!result?.status) continue;

      const status = mapStatus(result.status);
      if (status === "failed" || status === "timedOut") {
        const enriched = buildEnrichedError(result);
        out.push({
          testId: spec.id ?? testName,
          testName,
          file: spec.file ?? suite.file,
          line: spec.line,
          status,
          error: enriched.error,
          tags: spec.tags ?? [],
          durationMs: result.duration,
          errorSummary: enriched.errorSummary,
          failureLocation: enriched.failureLocation,
          callLog: enriched.callLog,
          errorContextMd: enriched.errorContextMd,
          pageEvidence: enriched.pageEvidence,
        } as FailedTest);
        continue;
      }

      out.push({
        testId: spec.id ?? testName,
        testName,
        file: spec.file ?? suite.file,
        line: spec.line,
        status,
        tags: spec.tags ?? [],
        durationMs: result.duration,
      });
    }
  }

  for (const child of suite.suites ?? []) {
    collectTests(child, suiteTitle, out);
  }
}

function walkTestResults(raw: PlaywrightJsonReport, visit: (result: PlaywrightTestResult) => void): void {
  function walkSuite(suite: PlaywrightSuite): void {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        for (const result of test.results ?? []) {
          visit(result);
        }
      }
    }
    for (const child of suite.suites ?? []) {
      walkSuite(child);
    }
  }

  for (const suite of raw.suites ?? []) {
    walkSuite(suite);
  }
}

/** Point attachment paths in results.json at case-local files (page-html.html, etc.). */
export function bindCaseAttachments(raw: PlaywrightJsonReport, caseDir: string): void {
  walkTestResults(raw, (result) => {
    for (const attachment of result.attachments ?? []) {
      const fileName = attachment.name ? CASE_ATTACHMENT_FILES[attachment.name] : undefined;
      if (!fileName) continue;
      const localPath = path.join(caseDir, fileName);
      if (fs.existsSync(localPath)) {
        attachment.path = localPath;
      }
    }
  });
}

function parseTestRun(raw: PlaywrightJsonReport): {
  tests: TestCase[];
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  failures: FailedTest[];
} {
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

/** Load results.json from a case folder; attachments resolve to files in that folder. */
export function loadCaseTestRun(caseDir: string): ReturnType<typeof parseTestRun> {
  const resultsPath = path.join(caseDir, "results.json");
  if (!fs.existsSync(resultsPath)) {
    throw new Error(`Playwright report not found: ${resultsPath}`);
  }

  const raw = JSON.parse(fs.readFileSync(resultsPath, "utf8")) as PlaywrightJsonReport;
  bindCaseAttachments(raw, caseDir);
  return parseTestRun(raw);
}
