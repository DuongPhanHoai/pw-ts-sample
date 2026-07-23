import fs from "node:fs";
import path from "node:path";
import type { FailureTriageResult } from "../../../scripts/lib/failure-triage";
import { chatJson } from "../../../scripts/lib/llm";

export interface GroundTruthGroup {
  expectedGroupId: string;
  expectedMembers: string[];
  expectedRootCause?: string;
  expectedCategory: string;
  expectedDetailFieldsNeeded?: string[];
}

export interface GroundTruth {
  caseLabel?: string;
  evalSteps?: string[];
  triage?: {
    groups: GroundTruthGroup[];
  };
  fixPlan?: {
    items: Array<Record<string, unknown>>;
  };
}

export function loadGroundTruth(caseDir: string): GroundTruth | undefined {
  const filePath = path.join(caseDir, "groundtruth.json");
  if (!fs.existsSync(filePath)) return undefined;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as GroundTruth;
}

function setOverlap(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const item of a) {
    if (b.has(item)) count++  ;
  }
  return count;
}

function f1(expected: Set<string>, predicted: Set<string>): number {
  if (expected.size === 0 && predicted.size === 0) return 1;
  const overlap = setOverlap(expected, predicted);
  if (overlap === 0) return 0;
  const precision = overlap / predicted.size;
  const recall = overlap / expected.size;
  return (2 * precision * recall) / (precision + recall);
}

function normalizeFields(fields: string[] | undefined): Set<string> {
  return new Set((fields ?? []).map((f) => f.trim()).filter(Boolean));
}

export interface TriageMetrics {
  categoryAccuracy: number;
  duplicateGroupingF1: number;
  detailFieldAccuracy: number;
  rootCauseAccuracy: number;
  triageScore: number;
  details: GroundTruthCheckDetail[];
  notes: string[];
}

export interface GroundTruthCheckDetail {
  groupId: string;
  testName: string;
  check: "members" | "category" | "detailFields" | "rootCause";
  expectedValue: string;
  actualValue: string;
  matchPercent: number;
  match: boolean;
  note?: string;
}

interface RootCauseJudgeResult {
  match: boolean;
  score: number;
  reason?: string;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function safeLabel(value: string): string {
  return value.replace(/[^\w.-]+/g, "_").slice(0, 60) || "unknown";
}

function asPercent(score: number): number {
  return Math.round(clamp01(score) * 1000) / 10;
}

function detailRow(input: GroundTruthCheckDetail): GroundTruthCheckDetail {
  return {
    ...input,
    matchPercent: Math.round(input.matchPercent * 10) / 10,
  };
}

function shouldUseAiGroundTruthJudge(): boolean {
  const raw = (process.env.AI_TEST_GROUNDTRUTH_AI_JUDGE ?? "true").toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "no";
}

async function judgeRootCause(
  expected: string,
  actual: string,
  groupId: string,
): Promise<{ score: number; match: boolean; reason: string }> {
  if (!shouldUseAiGroundTruthJudge()) {
    const expectedPrefix = expected.toLowerCase().slice(0, Math.min(40, expected.length));
    const deterministicMatch = actual.toLowerCase().includes(expectedPrefix);
    return {
      score: deterministicMatch ? 1 : 0,
      match: deterministicMatch,
      reason: deterministicMatch ? "Deterministic prefix match." : "Deterministic prefix mismatch.",
    };
  }

  const system = `You judge whether an LLM-predicted Playwright test root cause matches the expected ground truth.
Return ONLY valid JSON with this shape:
{
  "match": boolean,
  "score": 0.0,
  "reason": "short explanation"
}
Scoring:
- 1.0 means same root cause, even if wording differs.
- 0.75 means mostly same cause with minor missing detail.
- 0.5 means related but ambiguous.
- 0.0 means different cause.
Do not require exact wording. Focus on semantic equivalence.`;

  const user = `Expected root cause:
${expected}

Predicted root cause:
${actual}

Are these the same root cause?`;

  try {
    const result = await chatJson(system, user, {
      label: `groundtruth-root-cause-${safeLabel(groupId)}`,
      meta: {
        type: "groundtruth-root-cause-judge",
        groupId,
      },
    });
    const parsed = JSON.parse(result.content) as Partial<RootCauseJudgeResult>;
    const score = clamp01(Number(parsed.score));
    const match = parsed.match === true || score >= 0.75;
    return {
      score,
      match,
      reason: parsed.reason ?? "AI judge did not provide a reason.",
    };
  } catch (err) {
    const expectedPrefix = expected.toLowerCase().slice(0, Math.min(40, expected.length));
    const deterministicMatch = actual.toLowerCase().includes(expectedPrefix);
    return {
      score: deterministicMatch ? 1 : 0,
      match: deterministicMatch,
      reason: `AI judge failed; used deterministic fallback. ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function scoreTriage(
  predicted: FailureTriageResult,
  groundTruth: GroundTruth,
): Promise<TriageMetrics | undefined> {
  const expectedGroups = groundTruth.triage?.groups ?? [];
  if (expectedGroups.length === 0) return undefined;

  const notes: string[] = [];
  const details: GroundTruthCheckDetail[] = [];
  const predictedMembers = new Set(
    predicted.groups.flatMap((g) => g.memberTestNames),
  );
  const expectedMembers = new Set(expectedGroups.flatMap((g) => g.expectedMembers));

  const duplicateGroupingF1 = f1(expectedMembers, predictedMembers);
  details.push(
    detailRow({
      groupId: "__all__",
      testName: [...expectedMembers].join(" | "),
      check: "members",
      expectedValue: [...expectedMembers].join(" | "),
      actualValue: [...predictedMembers].join(" | "),
      matchPercent: asPercent(duplicateGroupingF1),
      match: duplicateGroupingF1 >= 0.999,
      note: "F1 overlap across all expected vs predicted member test names.",
    }),
  );
  if (predictedMembers.size !== expectedMembers.size) {
    notes.push(
      `Groups: predicted ${predicted.groups.length} group(s), ${predictedMembers.size} member(s); expected ${expectedGroups.length} group(s), ${expectedMembers.size} member(s).`,
    );
  }

  let categoryHits = 0;
  let detailHits = 0;
  let detailChecks = 0;
  let rootCauseHits = 0;
  let rootCauseChecks = 0;

  for (const expected of expectedGroups) {
    const expSet = new Set(expected.expectedMembers);
    const match = predicted.groups.find((g) => {
      const predSet = new Set(g.memberTestNames);
      return setOverlap(expSet, predSet) > 0;
    });

    if (!match) {
      notes.push(`No predicted group overlaps expected "${expected.expectedGroupId}".`);
      details.push(
        detailRow({
          groupId: expected.expectedGroupId,
          testName: expected.expectedMembers.join(" | "),
          check: "members",
          expectedValue: expected.expectedMembers.join(" | "),
          actualValue: "",
          matchPercent: 0,
          match: false,
          note: "No predicted group overlaps this expected group.",
        }),
      );
      continue;
    }

    const categoryMatch = match.likelyCategory === expected.expectedCategory;
    details.push(
      detailRow({
        groupId: expected.expectedGroupId,
        testName: expected.expectedMembers.join(" | "),
        check: "category",
        expectedValue: expected.expectedCategory,
        actualValue: match.likelyCategory ?? "",
        matchPercent: categoryMatch ? 100 : 0,
        match: categoryMatch,
      }),
    );
    if (categoryMatch) {
      categoryHits++;
    } else {
      notes.push(
        `Category mismatch for ${expected.expectedGroupId}: expected ${expected.expectedCategory}, got ${match.likelyCategory ?? "(none)"}.`,
      );
    }

    if (expected.expectedDetailFieldsNeeded?.length) {
      detailChecks++;
      const expFields = normalizeFields(expected.expectedDetailFieldsNeeded);
      const predFields = normalizeFields(match.detailFieldsNeeded);
      const fieldOverlap = setOverlap(expFields, predFields);
      const fieldScore = expFields.size > 0 ? fieldOverlap / expFields.size : 1;
      let fieldOk = true;
      for (const field of expFields) {
        if (!predFields.has(field)) {
          fieldOk = false;
          notes.push(`Missing detail field "${field}" for ${expected.expectedGroupId}.`);
        }
      }
      details.push(
        detailRow({
          groupId: expected.expectedGroupId,
          testName: expected.expectedMembers.join(" | "),
          check: "detailFields",
          expectedValue: [...expFields].join(" | "),
          actualValue: [...predFields].join(" | "),
          matchPercent: asPercent(fieldScore),
          match: fieldOk,
          note: "Expected fields must be present; extra actual fields are allowed.",
        }),
      );
      if (fieldOk) detailHits++;
    }

    if (expected.expectedRootCause) {
      rootCauseChecks++;
      const actualRootCause = `${match.triageSummary} ${match.duplicateReason ?? ""}`.trim();
      const judged = await judgeRootCause(
        expected.expectedRootCause,
        actualRootCause,
        expected.expectedGroupId,
      );
      details.push(
        detailRow({
          groupId: expected.expectedGroupId,
          testName: expected.expectedMembers.join(" | "),
          check: "rootCause",
          expectedValue: expected.expectedRootCause,
          actualValue: actualRootCause,
          matchPercent: asPercent(judged.score),
          match: judged.match,
          note: judged.reason,
        }),
      );
      rootCauseHits += judged.score;
      if (judged.match) {
        // Good enough for pass/fail notes; score is accumulated above.
      } else {
        notes.push(`Root cause text may not match for ${expected.expectedGroupId}.`);
      }
    }
  }

  const categoryAccuracy =
    expectedGroups.length > 0 ? categoryHits / expectedGroups.length : 0;
  const detailFieldAccuracy =
    detailChecks > 0 ? detailHits / detailChecks : 1;
  const rootCauseAccuracy =
    rootCauseChecks > 0 ? rootCauseHits / rootCauseChecks : 1;

  const triageScore =
    0.35 * rootCauseAccuracy +
    0.25 * duplicateGroupingF1 +
    0.25 * categoryAccuracy +
    0.15 * detailFieldAccuracy;

  return {
    categoryAccuracy,
    duplicateGroupingF1,
    detailFieldAccuracy,
    rootCauseAccuracy,
    triageScore,
    details,
    notes,
  };
}
