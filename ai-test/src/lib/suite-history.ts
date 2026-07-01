import fs from "node:fs";
import path from "node:path";
import { listCaseLabels, loadCase } from "./cases";
import { paths } from "../paths";
import type { SuiteReport } from "./suite-report";

const HISTORY_DIR = path.join(paths.reportsDir, "ai-test-history");
const HISTORY_CSV = path.join(HISTORY_DIR, "model_eval_history.csv");
const RUNS_CSV = path.join(HISTORY_DIR, "model_eval_runs.csv");

const FIXED_COLUMNS = ["case", "has_ground_truth", "failure_count"] as const;

const RUNS_COLUMNS = [
  "run_column",
  "model",
  "started_at_utc",
  "finished_at_utc",
  "total_duration_seconds",
  "passed",
  "failed",
  "errors",
  "skipped",
  "total_cases",
  "avg_triage_score",
] as const;

function sanitizeForPath(value: string): string {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "unknown";
}

export function buildRunId(startedAt: string, model: string | undefined): string {
  const ts = startedAt.replace(/[:.]/g, "-");
  const modelSlug = sanitizeForPath(model ?? "unknown");
  return `${ts}_${modelSlug}`;
}

export function formatRunColumn(model: string, startedAt: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const timestamp =
    `${startedAt.getUTCFullYear()}-${pad(startedAt.getUTCMonth() + 1)}-${pad(startedAt.getUTCDate())} ` +
    `${pad(startedAt.getUTCHours())}:${pad(startedAt.getUTCMinutes())}:${pad(startedAt.getUTCSeconds())} UTC`;
  return `${model} @ ${timestamp}`;
}

export function formatCell(status: string, durationSeconds: number | undefined): string {
  if (durationSeconds === undefined) return status;
  return `${status} (${durationSeconds.toFixed(1)}s)`;
}

function escapeCsvCell(value: string | number | boolean | undefined): string {
  if (value === undefined || value === null) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function csvRow(cells: (string | number | boolean | undefined)[]): string {
  return cells.map(escapeCsvCell).join(",");
}

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch === "\r") {
      // skip
    } else {
      cell += ch;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((r) => r.some((c) => c.length > 0));
}

function loadCaseTemplates(): Map<string, Record<string, string>> {
  const templates = new Map<string, Record<string, string>>();
  for (const label of listCaseLabels()) {
    const testCase = loadCase(label);
    templates.set(label, {
      case: label,
      has_ground_truth: testCase.hasGroundTruth ? "true" : "false",
      failure_count: String(testCase.failures.length),
    });
  }
  return templates;
}

function readHistoryMatrix(): { fieldnames: string[]; rows: Map<string, Record<string, string>> } {
  if (!fs.existsSync(HISTORY_CSV)) {
    return { fieldnames: [...FIXED_COLUMNS], rows: new Map() };
  }

  const parsed = parseCsv(fs.readFileSync(HISTORY_CSV, "utf8"));
  if (parsed.length === 0) {
    return { fieldnames: [...FIXED_COLUMNS], rows: new Map() };
  }

  const fieldnames = parsed[0]!;
  const rows = new Map<string, Record<string, string>>();

  for (let i = 1; i < parsed.length; i++) {
    const line = parsed[i]!;
    const row: Record<string, string> = {};
    for (let j = 0; j < fieldnames.length; j++) {
      row[fieldnames[j]!] = line[j] ?? "";
    }
    const key = row.case;
    if (key) rows.set(key, row);
  }

  return { fieldnames, rows };
}

function writeHistoryMatrix(fieldnames: string[], rows: Map<string, Record<string, string>>): void {
  const orderedKeys = [...rows.keys()].sort();
  const lines = [csvRow(fieldnames)];
  for (const key of orderedKeys) {
    const row = rows.get(key)!;
    lines.push(csvRow(fieldnames.map((name) => row[name] ?? "")));
  }
  fs.writeFileSync(HISTORY_CSV, `${lines.join("\n")}\n`, "utf8");
}

function appendRunMetadata(
  runColumn: string,
  report: SuiteReport,
  startedAt: Date,
  finishedAt: Date,
): void {
  const totalDurationSeconds =
    report.cases.reduce((sum, c) => sum + (c.durationMs ?? 0), 0) / 1000;

  const needsHeader = !fs.existsSync(RUNS_CSV);
  const row = csvRow([
    runColumn,
    report.model ?? "",
    startedAt.toISOString(),
    finishedAt.toISOString(),
    totalDurationSeconds.toFixed(3),
    report.passed,
    report.failed,
    report.errors,
    report.skipped,
    report.caseCount,
    report.averageTriageScore !== undefined ? report.averageTriageScore.toFixed(4) : "",
  ]);

  const payload = (needsHeader ? `${RUNS_COLUMNS.join(",")}\n` : "") + `${row}\n`;
  fs.appendFileSync(RUNS_CSV, payload, "utf8");
}

export interface SuiteHistoryResult {
  runId: string;
  runDir: string;
  historyCsv: string;
  runsCsv: string;
  runColumn: string;
}

export function appendSuiteHistory(report: SuiteReport): SuiteHistoryResult {
  const model = report.model ?? "unknown";
  const startedAt = new Date(report.startedAt ?? report.generatedAt);
  const finishedAt = new Date(report.generatedAt);
  const runColumn = formatRunColumn(model, startedAt);
  const runId = buildRunId(startedAt.toISOString(), model);
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

  const templates = loadCaseTemplates();
  let { fieldnames, rows } = readHistoryMatrix();

  for (const [key, template] of templates) {
    const existing = rows.get(key) ?? {};
    rows.set(key, {
      ...existing,
      ...template,
    });
  }

  for (const c of report.cases) {
    const key = c.label;
    if (!rows.has(key)) {
      rows.set(key, {
        case: key,
        has_ground_truth: c.hasGroundTruth ? "true" : "false",
        failure_count: String(c.failureCount),
      });
    }
    rows.get(key)![runColumn] = formatCell(c.status, (c.durationMs ?? 0) / 1000);
  }

  if (!fieldnames.includes(runColumn)) {
    fieldnames = [...fieldnames, runColumn];
  }

  writeHistoryMatrix(fieldnames, rows);
  appendRunMetadata(runColumn, report, startedAt, finishedAt);

  return {
    runId,
    runDir,
    historyCsv: HISTORY_CSV,
    runsCsv: RUNS_CSV,
    runColumn,
  };
}
