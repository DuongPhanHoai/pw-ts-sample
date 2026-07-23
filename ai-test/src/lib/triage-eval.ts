import fs from "node:fs";
import {
  requestFailureTriageWithDebug,
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

export interface TriageLlmDebug {
  prompt: {
    system: string;
    user: string;
  };
  response: {
    content: string;
    rawContent?: string;
    usage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
    logPath?: string;
  };
}

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
  const result = await runCaseTriageWithDebug(failures, stats);
  return result.triage;
}

export async function runCaseTriageWithDebug(
  failures: FailedTest[],
  stats: { passed: number; failed: number; skipped: number },
): Promise<{ triage: FailureTriageResult; debug: TriageLlmDebug }> {
  const ctx = loadStandardsContext();
  const llmResult = await requestFailureTriageWithDebug(ctx, failures, stats);
  const raw = llmResult.triage;
  const normalized = {
    ...raw,
    groups: raw.groups.map((g) => ({
      ...g,
      detailFieldsNeeded: normalizeDetailFields(g.detailFieldsNeeded),
    })),
  };
  return {
    triage: normalizeTriageResult(normalized, failures),
    debug: llmResult,
  };
}
