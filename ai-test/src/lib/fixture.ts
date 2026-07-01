import fs from "node:fs";
import path from "node:path";
import {
  loadTestRun,
  stripAnsi,
  type FailedTest,
} from "../../../scripts/lib/playwright-results";

export interface FailureGroup {
  id: string;
  fingerprint: string;
  failureLocation?: { file: string; line: number };
  callLog?: string;
  members: FailedTest[];
  representative: FailedTest;
}

export function failureFingerprint(failure: FailedTest): string {
  const loc = failure.failureLocation;
  const locKey = loc ? `${loc.file}:${loc.line}` : "unknown-location";
  const logKey = (failure.callLog ?? failure.errorSummary ?? "").trim();
  return `${locKey}|${logKey}`;
}

export function groupFailures(failures: FailedTest[]): FailureGroup[] {
  const map = new Map<string, FailedTest[]>();

  for (const failure of failures) {
    const key = failureFingerprint(failure);
    const list = map.get(key) ?? [];
    list.push(failure);
    map.set(key, list);
  }

  return [...map.entries()].map(([fingerprint, members], index) => ({
    id: String(index),
    fingerprint,
    failureLocation: members[0]?.failureLocation,
    callLog: members[0]?.callLog,
    members,
    representative: members[0]!,
  }));
}

function relRepoPath(absPath: string, root: string): string {
  return path.relative(root, absPath).split(path.sep).join("/");
}

export function formatScanLine(group: FailureGroup, root: string): string {
  const loc = group.failureLocation;
  const locText = loc
    ? `${relRepoPath(loc.file, root)}:${loc.line}`
    : "unknown location";
  const log = group.callLog ? stripAnsi(group.callLog).split("\n")[0] : "(no call log)";
  return [
    `[${group.id}] ${group.members.length} failure(s)`,
    `    at ${locText}`,
    `    ${log}`,
    `    example: ${group.representative.testName}`,
  ].join("\n");
}

interface PlaywrightAttachment {
  name?: string;
  path?: string;
}

interface PlaywrightTestResult {
  status?: string;
  attachments?: PlaywrightAttachment[];
}

interface PlaywrightSpec {
  title?: string;
  tests?: Array<{ results?: PlaywrightTestResult[] }>;
}

interface PlaywrightSuite {
  title?: string;
  specs?: PlaywrightSpec[];
  suites?: PlaywrightSuite[];
}

interface PlaywrightJsonReport {
  config?: unknown;
  suites?: PlaywrightSuite[];
  stats?: Record<string, number>;
}

function buildSpecTitle(parentTitle: string, specTitle?: string): string {
  return [parentTitle, specTitle].filter(Boolean).join(" > ");
}

function specHasMatchingFailure(
  spec: PlaywrightSpec,
  keepTestNames: Set<string>,
  suiteTitle: string,
): boolean {
  const title = buildSpecTitle(suiteTitle, spec.title);
  if (!keepTestNames.has(title)) return false;

  return (spec.tests ?? []).some((test) =>
    (test.results ?? []).some((result) => {
      const status = result.status;
      return status === "failed" || status === "timedOut";
    }),
  );
}

function filterSuite(
  suite: PlaywrightSuite,
  parentTitle: string,
  keepTestNames: Set<string>,
): PlaywrightSuite | null {
  const suiteTitle = [parentTitle, suite.title].filter(Boolean).join(" > ");

  const specs = (suite.specs ?? [])
    .filter((spec) => specHasMatchingFailure(spec, keepTestNames, suiteTitle))
    .map((spec) => {
      const title = buildSpecTitle(suiteTitle, spec.title);
      if (!keepTestNames.has(title)) return spec;
      return spec;
    });

  const suites = (suite.suites ?? [])
    .map((child) => filterSuite(child, suiteTitle, keepTestNames))
    .filter((child): child is PlaywrightSuite => child !== null);

  if (specs.length === 0 && suites.length === 0) return null;

  return {
    ...suite,
    specs,
    suites,
  };
}

export function trimPlaywrightReport(
  raw: PlaywrightJsonReport,
  keepTestNames: Set<string>,
): PlaywrightJsonReport {
  const suites = (raw.suites ?? [])
    .map((suite) => filterSuite(suite, "", keepTestNames))
    .filter((suite): suite is PlaywrightSuite => suite !== null);

  return {
    ...raw,
    suites,
    stats: {
      expected: 0,
      unexpected: keepTestNames.size,
      skipped: 0,
      flaky: 0,
    },
  };
}

function findAttachmentsForTestName(
  raw: PlaywrightJsonReport,
  testName: string,
): PlaywrightAttachment[] {
  function walkSuite(suite: PlaywrightSuite, parentTitle: string): PlaywrightAttachment[] {
    const suiteTitle = [parentTitle, suite.title].filter(Boolean).join(" > ");

    for (const spec of suite.specs ?? []) {
      const title = buildSpecTitle(suiteTitle, spec.title);
      if (title !== testName) continue;

      for (const test of spec.tests ?? []) {
        const result = test.results?.[test.results.length - 1];
        if (result?.attachments?.length) return result.attachments;
      }
    }

    for (const child of suite.suites ?? []) {
      const found = walkSuite(child, suiteTitle);
      if (found.length) return found;
    }

    return [];
  }

  for (const suite of raw.suites ?? []) {
    const found = walkSuite(suite, "");
    if (found.length) return found;
  }

  return [];
}

function copyIfExists(src: string | undefined, dest: string): boolean {
  if (!src || !fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return true;
}

function resolveAttachmentPath(
  attachments: PlaywrightAttachment[],
  name: string,
  testResultsDir: string,
): string | undefined {
  const fromReport = attachments.find((a) => a.name === name)?.path;
  if (fromReport && fs.existsSync(fromReport)) return fromReport;

  const candidates = fs
    .readdirSync(testResultsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(testResultsDir, d.name));

  for (const dir of candidates) {
    if (name === "error-context") {
      const p = path.join(dir, "error-context.md");
      if (fs.existsSync(p)) return p;
    }
    if (name === "page-html") {
      const p = path.join(dir, "page.html");
      if (fs.existsSync(p)) return p;
      const attDir = path.join(dir, "attachments");
      if (fs.existsSync(attDir)) {
        const att = fs
          .readdirSync(attDir, { withFileTypes: true })
          .find((f) => f.isFile() && f.name.startsWith("page-html-"));
        if (att) return path.join(attDir, att.name);
      }
    }
    if (name === "page-css") {
      const p = path.join(dir, "page.css");
      if (fs.existsSync(p)) return p;
      const attDir = path.join(dir, "attachments");
      if (fs.existsSync(attDir)) {
        const att = fs
          .readdirSync(attDir, { withFileTypes: true })
          .find((f) => f.isFile() && f.name.startsWith("page-css-"));
        if (att) return path.join(attDir, att.name);
      }
    }
  }

  return undefined;
}

export interface CaptureFixtureOptions {
  label: string;
  group: FailureGroup;
  scope: "single" | "group" | "all";
  resultsJsonPath: string;
  testResultsDir: string;
  outputDir: string;
  projectRoot: string;
}

export interface CaptureFixtureResult {
  outputDir: string;
  memberCount: number;
  files: string[];
}

export function captureFixture(options: CaptureFixtureOptions): CaptureFixtureResult {
  const raw = JSON.parse(
    fs.readFileSync(options.resultsJsonPath, "utf8"),
  ) as PlaywrightJsonReport;

  let members: FailedTest[];
  if (options.scope === "all") {
    const run = loadTestRun(options.resultsJsonPath);
    members = run.failures;
  } else if (options.scope === "group") {
    members = options.group.members;
  } else {
    members = [options.group.representative];
  }

  const keepTestNames = new Set(members.map((m) => m.testName));
  const trimmed =
    options.scope === "all"
      ? raw
      : trimPlaywrightReport(raw, keepTestNames);

  fs.mkdirSync(options.outputDir, { recursive: true });

  const written: string[] = [];
  const resultsOut = path.join(options.outputDir, "results.json");
  fs.writeFileSync(resultsOut, JSON.stringify(trimmed, null, 2), "utf8");
  written.push("results.json");

  const rep = options.group.representative;
  const attachments = findAttachmentsForTestName(raw, rep.testName);

  const artifactMap = [
    { name: "error-context", out: "error-context.md" },
    { name: "page-html", out: "page-html.html" },
    { name: "page-css", out: "page-css.css" },
  ] as const;

  for (const { name, out } of artifactMap) {
    const src = resolveAttachmentPath(attachments, name, options.testResultsDir);
    const dest = path.join(options.outputDir, out);
    if (copyIfExists(src, dest)) written.push(out);
  }

  const meta = {
    caseLabel: options.label,
    capturedAt: new Date().toISOString(),
    source: {
      resultsJson: relRepoPath(options.resultsJsonPath, options.projectRoot),
      testResultsDir: relRepoPath(options.testResultsDir, options.projectRoot),
    },
    scope: options.scope,
    failureGroup: {
      id: options.group.id,
      fingerprint: options.group.fingerprint,
      failureLocation: options.group.failureLocation
        ? {
            file: relRepoPath(options.group.failureLocation.file, options.projectRoot),
            line: options.group.failureLocation.line,
          }
        : undefined,
      callLog: options.group.callLog,
      memberTestNames: members.map((m) => m.testName),
      representativeTestName: rep.testName,
    },
  };

  const metaPath = path.join(options.outputDir, "capture-meta.json");
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");
  written.push("capture-meta.json");

  const readme = [
    `# ${options.label}`,
    "",
    "Captured from Playwright output via `npm run ai-test:capture`.",
    "",
    `- Failures in fixture: ${members.length}`,
    `- Representative: ${rep.testName}`,
    "",
    "Add `groundtruth.json` for scored eval (see ai-test/docs/LLM-EVAL-STRATEGY.md).",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(options.outputDir, "README.md"), readme, "utf8");
  written.push("README.md");

  return {
    outputDir: options.outputDir,
    memberCount: members.length,
    files: written,
  };
}
