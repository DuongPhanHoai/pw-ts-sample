import fs from "node:fs";
import path from "node:path";
import type { FailureTriageResult } from "../../../scripts/lib/failure-triage";

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
  notes: string[];
}

export function scoreTriage(
  predicted: FailureTriageResult,
  groundTruth: GroundTruth,
): TriageMetrics | undefined {
  const expectedGroups = groundTruth.triage?.groups ?? [];
  if (expectedGroups.length === 0) return undefined;

  const notes: string[] = [];
  const predictedMembers = new Set(
    predicted.groups.flatMap((g) => g.memberTestNames),
  );
  const expectedMembers = new Set(expectedGroups.flatMap((g) => g.expectedMembers));

  const duplicateGroupingF1 = f1(expectedMembers, predictedMembers);
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
      continue;
    }

    if (match.likelyCategory === expected.expectedCategory) {
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
      let fieldOk = true;
      for (const field of expFields) {
        if (!predFields.has(field)) {
          fieldOk = false;
          notes.push(`Missing detail field "${field}" for ${expected.expectedGroupId}.`);
        }
      }
      if (fieldOk) detailHits++;
    }

    if (expected.expectedRootCause) {
      rootCauseChecks++;
      const summary = `${match.triageSummary} ${match.duplicateReason ?? ""}`.toLowerCase();
      const needle = expected.expectedRootCause.toLowerCase();
      if (summary.includes(needle.slice(0, Math.min(40, needle.length)))) {
        rootCauseHits++;
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
    notes,
  };
}
