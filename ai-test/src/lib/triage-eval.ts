import fs from "node:fs";
import path from "node:path";
import {
  requestFailureTriage,
  type StandardsContext,
} from "../../../scripts/lib/llm-batch";
import {
  normalizeDetailFields,
  normalizeTriageResult,
  type FailureTriageResult,
} from "../../../scripts/lib/failure-triage";
import type { FailedTest } from "./case-report";
import { projectRoot } from "../paths";
import { paths as repoPaths } from "../../../scripts/lib/paths";

export function loadStandardsContext(): StandardsContext {
  return {
    uiStandards: fs.readFileSync(repoPaths.uiStandards, "utf8"),
    evaluationCriteria: fs.readFileSync(repoPaths.evaluationCriteria, "utf8"),
    autoHealPolicy: fs.readFileSync(repoPaths.autoHealPolicy, "utf8"),
    projectRoot,
  };
}

export async function runCaseTriage(
  failures: FailedTest[],
  stats: { passed: number; failed: number; skipped: number },
): Promise<FailureTriageResult> {
  const ctx = loadStandardsContext();
  const raw = await requestFailureTriage(ctx, failures, stats);
  const normalized = {
    ...raw,
    groups: raw.groups.map((g) => ({
      ...g,
      detailFieldsNeeded: normalizeDetailFields(g.detailFieldsNeeded),
    })),
  };
  return normalizeTriageResult(normalized, failures);
}
