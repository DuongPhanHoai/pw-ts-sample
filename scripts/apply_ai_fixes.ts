import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { chatText } from "./lib/llm";
import { loadTestRun, type FailedTest } from "./lib/playwright-results";
import { paths, projectRoot } from "./lib/paths";

type AutoFixMode = "false" | "dry-run" | "true";

const FixPlanSchema = z.object({
  failureSnapshots: z.record(z.string(), z.unknown()).optional(),
  plan: z.array(
    z.object({
      testId: z.string(),
      testName: z.string(),
      category: z.enum([
        "locators-broken",
        "timing-flaky",
        "backend-issue",
        "business-logic-change",
        "test-data-issue",
      ]),
      canAutoHeal: z.boolean(),
      confidence: z.number().min(0).max(1).optional(),
      proposedChangeSummary: z.string(),
      groupId: z.string().optional(),
      codeChangeHints: z.array(
        z.object({
          filePath: z.string(),
          reason: z.string(),
          suggestedSelectorOrChange: z.string(),
        }),
      ),
    }),
  ),
});

const PolicySchema = z.object({
  categories: z.record(
    z.object({
      description: z.string(),
      autoHeal: z.boolean(),
      allowedPaths: z.array(z.string()).optional(),
    }),
  ),
  maxFilesPerRun: z.number().optional(),
  minConfidence: z.number().optional(),
});

function getAutoFixMode(): AutoFixMode {
  const raw = (process.env.AUTO_FIX_TESTS ?? "false").toLowerCase();
  if (raw === "true" || raw === "dry-run" || raw === "false") return raw;
  throw new Error(`Invalid AUTO_FIX_TESTS="${process.env.AUTO_FIX_TESTS}". Use false | dry-run | true`);
}

function normalizeRelativePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const root = projectRoot.replace(/\\/g, "/");
  if (normalized.startsWith(root)) {
    return normalized.slice(root.length + 1);
  }
  return normalized.replace(/^\.\//, "");
}

function isAllowedPath(relativePath: string, allowedPrefixes?: string[]): boolean {
  if (!allowedPrefixes?.length) return relativePath.startsWith("tests/");
  return allowedPrefixes.some(
    (prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}/`),
  );
}

type PlanItem = z.infer<typeof FixPlanSchema>["plan"][number];

function resolveFailureLine(
  item: PlanItem,
  failuresByTestName: Map<string, FailedTest>,
  snapshots: Record<string, unknown>,
): number | undefined {
  const snap = snapshots[item.testName] as Partial<FailedTest> | undefined;
  const live = failuresByTestName.get(item.testName);
  return (
    live?.failureLocation?.line ??
    failuresByTestName.get(item.testName)?.failureLocation?.line ??
    snap?.failureLocation?.line
  );
}

/** One apply action per file+line (or file+group), not per file only. */
function resolveApplyTargetKey(
  item: PlanItem,
  failuresByTestName: Map<string, FailedTest>,
  snapshots: Record<string, unknown>,
): string | null {
  const file = normalizeRelativePath(item.codeChangeHints[0]?.filePath ?? "");
  if (!file) return null;

  const line = resolveFailureLine(item, failuresByTestName, snapshots);
  if (line) return `${file}:${line}`;
  if (item.groupId) return `${file}:${item.groupId}`;
  return `${file}:${item.testName}`;
}

function logApply(section: string, details: Record<string, unknown>): void {
  console.log(`\n[apply] ${section}`);
  for (const [key, value] of Object.entries(details)) {
    if (value === undefined) continue;
    const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    console.log(`  ${key}: ${text}`);
  }
}

function logLineDiff(before: string, after: string, filePath: string): void {
  const bLines = before.split(/\r?\n/);
  const aLines = after.split(/\r?\n/);
  const changed: string[] = [];
  const max = Math.max(bLines.length, aLines.length);
  for (let i = 0; i < max; i++) {
    if (bLines[i] !== aLines[i]) {
      changed.push(
        `    L${i + 1} - ${(bLines[i] ?? "(missing)").trim()}`,
        `    L${i + 1} + ${(aLines[i] ?? "(missing)").trim()}`,
      );
    }
  }
  if (changed.length === 0) {
    console.log(`  diff (${filePath}): (no line changes)`);
    return;
  }
  console.log(`  diff (${filePath}):`);
  for (const line of changed) console.log(line);
}

function asFailedTest(snapshot: unknown): FailedTest | undefined {
  if (!snapshot || typeof snapshot !== "object") return undefined;
  const s = snapshot as Partial<FailedTest>;
  if (!s.testName || !s.error) return undefined;
  return s as FailedTest;
}

function mergeFailure(live?: FailedTest, snap?: FailedTest): FailedTest | undefined {
  if (!live && !snap) return undefined;
  if (!live) return snap;
  if (!snap) return live;
  return {
    ...live,
    pageEvidence: live.pageEvidence ?? snap.pageEvidence,
    errorContextMd: live.errorContextMd ?? snap.errorContextMd,
    callLog: live.callLog ?? snap.callLog,
    failureLocation: live.failureLocation ?? snap.failureLocation,
  };
}

async function main(): Promise<void> {
  const mode = getAutoFixMode();
  console.log(`AUTO_FIX_TESTS=${mode}`);

  if (mode === "false") {
    console.log("Auto-fix disabled. Analysis only.");
    return;
  }

  if (!fs.existsSync(paths.aiFixPlan)) {
    console.error(`Missing ${paths.aiFixPlan}. Run analyze:results first.`);
    process.exit(1);
  }

  const policy = PolicySchema.parse(
    JSON.parse(fs.readFileSync(paths.autoHealPolicy, "utf8")),
  );
  const fixPlanRaw = JSON.parse(fs.readFileSync(paths.aiFixPlan, "utf8"));
  const fixPlan = FixPlanSchema.parse(fixPlanRaw);
  const snapshots = fixPlan.failureSnapshots ?? {};

  const failuresByTestName = new Map<string, FailedTest>();
  if (fs.existsSync(paths.resultsJson)) {
    for (const failure of loadTestRun(paths.resultsJson).failures) {
      failuresByTestName.set(failure.testName, failure);
    }
  }

  const minConfidence = policy.minConfidence ?? 0.75;
  const maxFiles = policy.maxFilesPerRun ?? 3;

  const candidates = fixPlan.plan.filter((item) => {
    const categoryPolicy = policy.categories[item.category];
    if (!categoryPolicy?.autoHeal) return false;
    if (!item.canAutoHeal) return false;
    if ((item.confidence ?? 1) < minConfidence) return false;
    return item.codeChangeHints.length > 0;
  });

  if (candidates.length === 0) {
    console.log("No auto-healable items in fix plan.");
    return;
  }

  const seenTargets = new Set<string>();
  const uniqueCandidates = candidates.filter((item) => {
    const key = resolveApplyTargetKey(item, failuresByTestName, snapshots);
    if (!key || seenTargets.has(key)) return false;
    seenTargets.add(key);
    return true;
  });

  const skippedDuplicateTargets = candidates.length - uniqueCandidates.length;
  console.log(
    `Apply targets: ${uniqueCandidates.length} fix target(s) from ${candidates.length} plan row(s)` +
      (skippedDuplicateTargets > 0
        ? ` (${skippedDuplicateTargets} duplicate file/line target(s) skipped)`
        : ""),
  );

  const touched = new Set<string>();
  const audit: unknown[] = [];

  for (const item of uniqueCandidates) {
    if (touched.size >= maxFiles) break;

    const applyTargetKey = resolveApplyTargetKey(item, failuresByTestName, snapshots);
    if (!applyTargetKey) continue;

    const failure = mergeFailure(
      failuresByTestName.get(item.testName),
      asFailedTest(snapshots[item.testName]),
    );
    const hint = item.codeChangeHints[0];
    const relativePath = normalizeRelativePath(hint.filePath);

    logApply("candidate", {
      applyTarget: applyTargetKey,
      testName: item.testName,
      file: relativePath,
      category: item.category,
      confidence: item.confidence,
      proposedChangeSummary: item.proposedChangeSummary,
      hintReason: hint.reason,
      hintSuggested: hint.suggestedSelectorOrChange,
      failureSource: failure
        ? failuresByTestName.has(item.testName)
          ? "results.json+snapshot"
          : "ai-fix-plan.failureSnapshots"
        : "none",
      failureLine: failure?.failureLocation?.line,
    });

    if (touched.has(applyTargetKey)) {
      logApply("skip", {
        reason: "target already applied this run",
        applyTarget: applyTargetKey,
      });
      continue;
    }

    const categoryPolicy = policy.categories[item.category];

    if (!isAllowedPath(relativePath, categoryPolicy.allowedPaths)) {
      console.warn(`Skipping disallowed path: ${relativePath}`);
      continue;
    }

    const fullPath = path.join(projectRoot, relativePath);
    if (!fs.existsSync(fullPath)) {
      console.warn(`File not found: ${fullPath}`);
      continue;
    }

    const original = fs.readFileSync(fullPath, "utf8");

    logApply("llm apply", {
      file: relativePath,
      proposedChangeSummary: item.proposedChangeSummary,
    });

    const system =
      "You are an expert Playwright + TypeScript test engineer. Return ONLY the full updated file content. No markdown fences.";
    const user = JSON.stringify(
      {
        task: "Apply ONE minimal fix from the fix plan. Change only what the hint describes; do not rewrite unrelated lines.",
        testName: item.testName,
        category: item.category,
        proposedChangeSummary: item.proposedChangeSummary,
        hint,
        failureLocation: failure?.failureLocation,
        filePath: relativePath,
        rules: [
          "Apply the change described in hint.suggestedSelectorOrChange.",
          "Do NOT substitute a different element from later steps in the same method.",
          "Keep imports, method order, and all other code unchanged unless the hint requires it.",
        ],
        currentFileContent: original,
      },
      null,
      2,
    );
    const result = await chatText(system, user, {
      label: `apply-fix-${item.testId.slice(0, 8)}`,
      meta: { type: "apply-fix", testName: item.testName, filePath: relativePath },
    });
    const updated = result.content;

    if (!updated || updated.trim() === original.trim()) {
      logApply("skip", { reason: "no effective change after apply attempt", file: relativePath });
      continue;
    }

    logLineDiff(original, updated, relativePath);

    const entry = {
      mode,
      testName: item.testName,
      category: item.category,
      filePath: relativePath,
      applyMethod: "llm" as const,
      proposedChangeSummary: item.proposedChangeSummary,
      at: new Date().toISOString(),
    };

    if (mode === "dry-run") {
      logApply("dry-run would write", {
        file: relativePath,
        method: "llm",
        chars: `${original.length} → ${updated.length}`,
      });
      audit.push({ ...entry, action: "dry-run", applyTarget: applyTargetKey });
      touched.add(applyTargetKey);
      continue;
    }

    fs.writeFileSync(fullPath, updated, "utf8");
    logApply("applied", { file: relativePath, method: "llm", applyTarget: applyTargetKey });
    audit.push({ ...entry, action: "applied", applyTarget: applyTargetKey });
    touched.add(applyTargetKey);
  }

  if (audit.length > 0) {
    fs.mkdirSync(path.dirname(paths.fixAudit), { recursive: true });
    const existing = fs.existsSync(paths.fixAudit)
      ? JSON.parse(fs.readFileSync(paths.fixAudit, "utf8"))
      : [];
    fs.writeFileSync(paths.fixAudit, JSON.stringify([...existing, ...audit], null, 2), "utf8");
  }

  if (mode === "true" && touched.size > 0) {
    console.log("\nRe-run failed tests: npx playwright test --last-failed");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
