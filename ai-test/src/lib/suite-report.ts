import fs from "node:fs";
import path from "node:path";
import type { FailureTriageResult } from "../../../scripts/lib/failure-triage";
import { paths } from "../paths";
import type { TriageMetrics } from "./score-triage";
import { appendSuiteHistory, type SuiteHistoryResult } from "./suite-history";

export type SuiteCaseStatus = "pass" | "fail" | "skipped" | "error";

export interface SuiteCaseResult {
  label: string;
  status: SuiteCaseStatus;
  failureCount: number;
  artifactFiles: string[];
  hasGroundTruth: boolean;
  durationMs?: number;
  error?: string;
  triage?: FailureTriageResult;
  metrics?: TriageMetrics;
}

export interface SuiteReport {
  generatedAt: string;
  model?: string;
  caseCount: number;
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
  averageTriageScore?: number;
  cases: SuiteCaseResult[];
}

export function suiteReportPaths() {
  const base = path.join(paths.reportsDir, "ai-test-suite");
  return {
    json: path.join(paths.reportsDir, "ai-test-suite.json"),
    markdown: path.join(paths.reportsDir, "ai-test-suite.md"),
    caseDir: base,
  };
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function statusIcon(status: SuiteCaseStatus): string {
  switch (status) {
    case "pass":
      return "PASS";
    case "fail":
      return "FAIL";
    case "error":
      return "ERROR";
    case "skipped":
      return "SKIP";
  }
}

export function renderSuiteMarkdown(report: SuiteReport): string {
  const lines: string[] = [
    "# AI test suite report",
    "",
    `Generated: ${report.generatedAt}`,
    `Step: **triage LLM**`,
  ];

  if (report.model) lines.push(`Model: \`${report.model}\``);
  lines.push(
    "",
    "## Summary",
    "",
    "| Metric | Value |",
    "|--------|-------|",
    `| Cases | ${report.caseCount} |`,
    `| Passed | ${report.passed} |`,
    `| Failed | ${report.failed} |`,
    `| Errors | ${report.errors} |`,
    `| Skipped | ${report.skipped} |`,
  );

  if (report.averageTriageScore !== undefined) {
    lines.push(`| Avg triage score | ${pct(report.averageTriageScore)} |`);
  }

  lines.push("", "## Cases", "", "| Case | Status | Failures | Ground truth | Triage score | Notes |", "|------|--------|----------|--------------|--------------|-------|");

  for (const c of report.cases) {
    const score =
      c.metrics?.triageScore !== undefined ? pct(c.metrics.triageScore) : "—";
    const gt = c.hasGroundTruth ? "yes" : "no";
    const note = c.error ?? c.metrics?.notes?.[0] ?? "";
    lines.push(
      `| ${c.label} | ${statusIcon(c.status)} | ${c.failureCount} | ${gt} | ${score} | ${note.replace(/\|/g, "\\|")} |`,
    );
  }

  lines.push(
    "",
    "## Outputs",
    "",
    "- JSON: `reports/ai-test-suite.json`",
    "- Per-case triage: `reports/ai-test-suite/<case-label>/triage.json`",
    "- History CSV: `reports/ai-test-history/summary.csv` (one row per case per run; filter by `model`)",
    "",
    "Open this report:",
    "",
    "```powershell",
    "start reports\\ai-test-suite.md",
    "```",
    "",
  );

  const triageCases = report.cases.filter((c) => c.triage);
  if (triageCases.length > 0) {
    lines.push("## Triage details", "");
    for (const c of triageCases) {
      lines.push(`### ${c.label}`, "");
      for (const g of c.triage!.groups) {
        lines.push(
          `- **${g.groupId}** (${g.memberTestNames.length} test(s)) — \`${g.likelyCategory ?? "?"}\``,
        );
        lines.push(`  - ${g.triageSummary}`);
        lines.push(`  - Detail: ${g.detailFieldsNeeded.join(", ")}`);
      }
      if (c.metrics?.notes?.length) {
        lines.push("", "Scoring notes:");
        for (const n of c.metrics.notes) lines.push(`- ${n}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

export function writeSuiteReport(report: SuiteReport): {
  json: string;
  markdown: string;
  history: SuiteHistoryResult;
} {
  const out = suiteReportPaths();
  fs.mkdirSync(out.caseDir, { recursive: true });
  fs.mkdirSync(paths.reportsDir, { recursive: true });

  for (const c of report.cases) {
    if (c.triage) {
      const caseOut = path.join(out.caseDir, c.label);
      fs.mkdirSync(caseOut, { recursive: true });
      fs.writeFileSync(
        path.join(caseOut, "triage.json"),
        JSON.stringify(c.triage, null, 2),
        "utf8",
      );
    }
  }

  fs.writeFileSync(out.json, JSON.stringify(report, null, 2), "utf8");
  const md = renderSuiteMarkdown(report);
  fs.writeFileSync(out.markdown, md, "utf8");
  const history = appendSuiteHistory(report);
  return { json: out.json, markdown: out.markdown, history };
}
