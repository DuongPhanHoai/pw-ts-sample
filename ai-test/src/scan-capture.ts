import fs from "node:fs";
import path from "node:path";
import {
  captureFixture,
  formatScanLine,
  groupFailures,
} from "./lib/fixture";
import { loadTestRun } from "../../scripts/lib/playwright-results";
import { paths, projectRoot } from "./paths";

function usage(): never {
  console.log(`Usage:
  npm run ai-test:scan
    List failure groups from reports/results.json (+ test-results attachments).

  npm run ai-test:capture -- --label <case-label> [options]
    Export a fixture folder under ai-test/inputs/<case-label>/.

Options:
  --label <name>     Required. Folder name (e.g. locator-checkout-btn).
  --group <id>       Failure group id from scan (default: 0).
  --scope <mode>     single | group | all (default: single)
  --results <path>   Playwright JSON report (default: reports/results.json)
  --test-results <path>  test-results dir (default: test-results)
`);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  const positional = argv[0];
  const flags: Record<string, string> = {};
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    }
  }
  return { command: positional, flags };
}

function scan(reportPath: string): void {
  if (!fs.existsSync(reportPath)) {
    console.error(`Report not found: ${reportPath}`);
    console.error("Run Playwright first: npm test");
    process.exit(1);
  }

  const run = loadTestRun(reportPath);
  const groups = groupFailures(run.failures);

  console.log(
    `Playwright failures: ${run.failures.length} test(s), ${groups.length} root-cause group(s)\n`,
  );

  if (groups.length === 0) {
    console.log("No failures to capture.");
    return;
  }

  for (const group of groups) {
    console.log(formatScanLine(group, projectRoot));
    console.log("");
  }

  console.log("Capture examples:");
  console.log(
    "  npm run ai-test:capture -- --label locator-checkout-btn --group 0 --scope single",
  );
  console.log(
    "  npm run ai-test:capture -- --label duplicate-matrix-locator --group 0 --scope group",
  );
}

function capture(flags: Record<string, string>): void {
  const label = flags.label;
  if (!label) {
    console.error("Missing --label <case-label>");
    usage();
  }

  const reportPath = path.resolve(projectRoot, flags.results ?? paths.resultsJson);
  const testDir = path.resolve(
    projectRoot,
    flags["test-results"] ?? paths.testResultsDir,
  );
  const groupId = flags.group ?? "0";
  const scope = (flags.scope ?? "single") as "single" | "group" | "all";

  if (!["single", "group", "all"].includes(scope)) {
    console.error(`Invalid --scope: ${scope}`);
    process.exit(1);
  }

  if (!fs.existsSync(reportPath)) {
    console.error(`Report not found: ${reportPath}`);
    process.exit(1);
  }

  const run = loadTestRun(reportPath);
  const groups = groupFailures(run.failures);

  if (groups.length === 0) {
    console.error("No failures in report.");
    process.exit(1);
  }

  const group = groups.find((g) => g.id === groupId);
  if (!group) {
    console.error(`Group not found: ${groupId}. Run npm run ai-test:scan`);
    process.exit(1);
  }

  const outputDir = path.join(paths.inputs, label);
  if (fs.existsSync(outputDir)) {
    console.error(`Output already exists: ${outputDir}`);
    console.error("Remove it or pick a different --label.");
    process.exit(1);
  }

  const result = captureFixture({
    label,
    group,
    scope,
    resultsJsonPath: reportPath,
    testResultsDir: testDir,
    outputDir,
    projectRoot,
  });

  console.log(
    `Captured ${result.memberCount} failure(s) → ${path.relative(projectRoot, result.outputDir)}`,
  );
  console.log(`Files: ${result.files.join(", ")}`);
  console.log("Next: add groundtruth.json for scored eval.");
}

function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));

  if (command === "scan" || !command) {
    scan(path.resolve(projectRoot, flags.results ?? paths.resultsJson));
    return;
  }

  if (command === "capture") {
    capture(flags);
    return;
  }

  usage();
}

main();
