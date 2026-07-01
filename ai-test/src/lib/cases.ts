import fs from "node:fs";
import path from "node:path";
import { loadCaseTestRun, type FailedTest } from "./case-report";
import { paths } from "../paths";

export interface AiTestCase {
  label: string;
  dir: string;
  run: ReturnType<typeof loadCaseTestRun>;
  failures: FailedTest[];
  hasGroundTruth: boolean;
  artifactFiles: string[];
}

const ARTIFACT_NAMES = [
  "results.json",
  "error-context.md",
  "page-html.html",
  "page-css.css",
  "groundtruth.json",
  "README.md",
] as const;

export function listCaseLabels(inputsDir = paths.inputs): string[] {
  if (!fs.existsSync(inputsDir)) return [];

  return fs
    .readdirSync(inputsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(inputsDir, name, "results.json")))
    .sort();
}

export function loadCase(label: string, inputsDir = paths.inputs): AiTestCase {
  const dir = path.join(inputsDir, label);
  const resultsPath = path.join(dir, "results.json");

  if (!fs.existsSync(resultsPath)) {
    throw new Error(`Case not found: ${label} (missing ${resultsPath})`);
  }

  const run = loadCaseTestRun(dir);
  const artifactFiles = ARTIFACT_NAMES.filter((name) => fs.existsSync(path.join(dir, name)));

  return {
    label,
    dir,
    run,
    failures: run.failures,
    hasGroundTruth: fs.existsSync(path.join(dir, "groundtruth.json")),
    artifactFiles,
  };
}

export function loadCases(labels?: string[]): AiTestCase[] {
  const selected = labels?.length ? labels : listCaseLabels();
  if (selected.length === 0) {
    throw new Error("No cases found under ai-test/inputs/ (need <label>/results.json)");
  }
  return selected.map((label) => loadCase(label));
}

export type { FailedTest };
