import fs from "node:fs";
import path from "node:path";
import { paths } from "../paths";
import type { SuiteReport } from "./suite-report";

const HISTORY_DIR = path.join(paths.reportsDir, "ai-test-history");
const SUMMARY_CSV = path.join(HISTORY_DIR, "summary.csv");

const CSV_HEADER =
  "runAt,model,case,status,failureCount,hasGroundTruth,triageScore,categoryAccuracy,duplicateGroupingF1,detailFieldAccuracy,rootCauseAccuracy,durationMs,runDir";

function sanitizeForPath(value: string): string {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "unknown";
}

export function buildRunId(generatedAt: string, model: string | undefined): string {
  const ts = generatedAt.replace(/[:.]/g, "-");
  const modelSlug = sanitizeForPath(model ?? "unknown");
  return `${ts}_${modelSlug}`;
}

function escapeCsvCell(value: string | number | boolean | undefined): string {
  if (value === undefined || value === null) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function formatScore(value: number | undefined): string {
  return value === undefined ? "" : value.toFixed(4);
}

function csvRow(cells: (string | number | boolean | undefined)[]): string {
  return cells.map(escapeCsvCell).join(",");
}

export interface SuiteHistoryResult {
  runId: string;
  runDir: string;
  summaryCsv: string;
}

export function appendSuiteHistory(report: SuiteReport): SuiteHistoryResult {
  const runId = buildRunId(report.generatedAt, report.model);
  const runDir = path.join(HISTORY_DIR, runId);

  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "suite.json"), JSON.stringify(report, null, 2), "utf8");

  for (const c of report.cases) {
    if (!c.triage) continue;
    const caseDir = path.join(runDir, c.label);
    fs.mkdirSync(caseDir, { recursive: true });
    fs.writeFileSync(
      path.join(caseDir, "triage.json"),
      JSON.stringify(c.triage, null, 2),
      "utf8",
    );
  }

  const relativeRunDir = path.relative(paths.reportsDir, runDir).replace(/\\/g, "/");
  const rows = report.cases.map((c) =>
    csvRow([
      report.generatedAt,
      report.model ?? "",
      c.label,
      c.status,
      c.failureCount,
      c.hasGroundTruth,
      formatScore(c.metrics?.triageScore),
      formatScore(c.metrics?.categoryAccuracy),
      formatScore(c.metrics?.duplicateGroupingF1),
      formatScore(c.metrics?.detailFieldAccuracy),
      formatScore(c.metrics?.rootCauseAccuracy),
      c.durationMs,
      relativeRunDir,
    ]),
  );

  const needsHeader = !fs.existsSync(SUMMARY_CSV);
  const payload = (needsHeader ? `${CSV_HEADER}\n` : "") + `${rows.join("\n")}\n`;
  fs.appendFileSync(SUMMARY_CSV, payload, "utf8");

  return { runId, runDir, summaryCsv: SUMMARY_CSV };
}
