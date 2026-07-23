import "dotenv/config";
import { execSync } from "node:child_process";
import path from "node:path";
import { paths } from "./paths";
import { loadCases, listCaseLabels } from "./lib/cases";
import { loadGroundTruth, scoreTriage } from "./lib/score-triage";
import {
  renderSuiteMarkdown,
  writeSuiteReport,
  type SuiteCaseResult,
  type SuiteReport,
} from "./lib/suite-report";
import { runCaseTriageWithDebug } from "./lib/triage-eval";

function usage(): never {
  console.log(`Usage:
  npm run ai-test:suite [options]

Run triage LLM on each fixture case under ai-test/inputs/ (requires LM Studio + .env).

Options:
  --case <label>             Repeatable; default = all cases with results.json
  --open                     Open ai-reports/ai-test-suite.md after run
  --min-score <0-1>          Fail case when triageScore is below (default 0.8, needs groundtruth.json)
`);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  const flags: Record<string, string | string[]> = {};
  const cases: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];

    if (key === "case") {
      if (next && !next.startsWith("--")) {
        cases.push(next);
        i++;
      }
      continue;
    }

    if (next && !next.startsWith("--")) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = "true";
    }
  }

  return { flags, cases };
}

function assertLlmConfigured(): void {
  if (!process.env.LMSTUDIO_BASE_URL?.trim()) {
    console.error("LMSTUDIO_BASE_URL is not set. Configure .env for LM Studio.");
    process.exit(1);
  }
  if (!process.env.LMSTUDIO_MODEL?.trim()) {
    console.error("LMSTUDIO_MODEL is not set. Configure .env for LM Studio.");
    process.exit(1);
  }
}

async function runCase(label: string, minScore?: number): Promise<SuiteCaseResult> {
  const started = Date.now();
  try {
    const testCase = loadCases([label])[0]!;
    if (testCase.failures.length === 0) {
      return {
        label,
        status: "skipped",
        failureCount: 0,
        artifactFiles: testCase.artifactFiles,
        hasGroundTruth: testCase.hasGroundTruth,
        durationMs: Date.now() - started,
        error: "No failures to triage",
      };
    }

    const stats = {
      passed: testCase.run.passed,
      failed: testCase.run.failed,
      skipped: testCase.run.skipped,
    };

    console.log(`  [${label}] triage LLM (${testCase.failures.length} failure(s))…`);
    const { triage, debug } = await runCaseTriageWithDebug(testCase.failures, stats);

    const groundTruth = loadGroundTruth(testCase.dir);
    let metrics;
    let status: SuiteCaseResult["status"] = "pass";

    if (groundTruth) {
      metrics = await scoreTriage(triage, groundTruth);
      const threshold = minScore ?? 0.8;
      if (metrics && metrics.triageScore < threshold) {
        status = "fail";
      }
    }

    return {
      label,
      status,
      failureCount: testCase.failures.length,
      artifactFiles: testCase.artifactFiles,
      hasGroundTruth: testCase.hasGroundTruth,
      durationMs: Date.now() - started,
      triage,
      llmDebug: {
        triage: debug,
      },
      metrics,
      error:
        status === "fail" && metrics
          ? `triage score ${metrics.triageScore.toFixed(3)} below threshold`
          : undefined,
    };
  } catch (err) {
    return {
      label,
      status: "error",
      failureCount: 0,
      artifactFiles: [],
      hasGroundTruth: false,
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function openReport(markdownPath: string): void {
  try {
    if (process.platform === "win32") {
      execSync(`start "" "${markdownPath}"`, { stdio: "ignore", shell: "cmd.exe" });
    } else if (process.platform === "darwin") {
      execSync(`open "${markdownPath}"`, { stdio: "ignore" });
    } else {
      execSync(`xdg-open "${markdownPath}"`, { stdio: "ignore" });
    }
  } catch {
    console.log(`Open manually: ${markdownPath}`);
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    usage();
  }

  assertLlmConfigured();
  process.env.LMSTUDIO_LLM_LOG_DIR ??= path.join(paths.reportsDir, "llm-prompts");

  const { flags, cases } = parseArgs(process.argv.slice(2));
  const labels = cases.length > 0 ? cases : listCaseLabels();
  if (labels.length === 0) {
    console.error("No cases under ai-test/inputs/. Add <label>/results.json (+ attachments) first.");
    process.exit(1);
  }

  const minScore = flags["min-score"] ? Number(flags["min-score"]) : undefined;

  const startedAt = new Date();

  console.log(`AI test suite — triage LLM, cases=${labels.join(", ")}`);
  console.log(`Model: ${process.env.LMSTUDIO_MODEL}\n`);

  const results: SuiteCaseResult[] = [];
  for (const label of labels) {
    results.push(await runCase(label, minScore));
  }

  const finishedAt = new Date();

  const scored = results.filter((r) => r.metrics?.triageScore !== undefined);
  const averageTriageScore =
    scored.length > 0
      ? scored.reduce((sum, r) => sum + (r.metrics?.triageScore ?? 0), 0) / scored.length
      : undefined;

  const report: SuiteReport = {
    startedAt: startedAt.toISOString(),
    generatedAt: finishedAt.toISOString(),
    model: process.env.LMSTUDIO_MODEL,
    caseCount: results.length,
    passed: results.filter((r) => r.status === "pass").length,
    failed: results.filter((r) => r.status === "fail").length,
    errors: results.filter((r) => r.status === "error").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    averageTriageScore,
    cases: results,
  };

  const { markdown, history } = writeSuiteReport(report);

  console.log("");
  console.log(renderSuiteMarkdown(report).split("\n").slice(0, 16).join("\n"));
  console.log(`\nWrote ai-reports/ai-test-suite.json`);
  console.log(`Wrote ai-reports/ai-test-suite.md`);
  console.log(`Updated history: ai-reports/ai-test-history/model_eval_history.csv`);
  console.log(`Run column: ${history.runColumn}`);
  console.log(`Appended run log: ai-reports/ai-test-history/model_eval_runs.csv`);
  console.log(`Appended scores: ai-reports/ai-test-history/model_eval_scores.csv`);
  console.log(`Appended groundtruth details: ai-reports/ai-test-history/model_eval_groundtruth_details.csv`);
  console.log(`Run snapshot: ai-reports/ai-test-history/${history.runId}/`);
  console.log(`Run detail CSV: ai-reports/ai-test-history/${history.runId}/model_eval_groundtruth_details.csv`);

  if (flags.open === "true") {
    openReport(markdown);
  } else {
    console.log(`\nView report: start ai-reports\\ai-test-suite.md`);
  }

  if (report.failed > 0 || report.errors > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
