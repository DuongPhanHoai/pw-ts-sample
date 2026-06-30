import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { chatText } from "./lib/llm";
import { paths, projectRoot } from "./lib/paths";

type AutoFixMode = "false" | "dry-run" | "true";

const FixPlanSchema = z.object({
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
  const fixPlan = FixPlanSchema.parse(
    JSON.parse(fs.readFileSync(paths.aiFixPlan, "utf8")),
  );

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

  const touched = new Set<string>();
  const audit: unknown[] = [];

  for (const item of candidates) {
    if (touched.size >= maxFiles) break;

    const hint = item.codeChangeHints[0];
    const relativePath = normalizeRelativePath(hint.filePath);
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

    if (touched.has(relativePath)) continue;

    const original = fs.readFileSync(fullPath, "utf8");
    const system =
      "You are an expert Playwright + TypeScript test engineer. Return ONLY the full updated file content. No markdown fences.";
    const user = JSON.stringify(
      {
        task: "Fix the test or page object with minimal changes.",
        testName: item.testName,
        category: item.category,
        proposedChangeSummary: item.proposedChangeSummary,
        hint,
        filePath: relativePath,
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
      console.warn(`No effective change for ${relativePath}`);
      continue;
    }

    const entry = {
      mode,
      testName: item.testName,
      category: item.category,
      filePath: relativePath,
      at: new Date().toISOString(),
    };

    if (mode === "dry-run") {
      console.log(`\n--- dry-run: ${relativePath} ---`);
      console.log(`Summary: ${item.proposedChangeSummary}`);
      console.log(`Would update ${relativePath} (${original.length} -> ${updated.length} chars)`);
      audit.push({ ...entry, action: "dry-run" });
      touched.add(relativePath);
      continue;
    }

    fs.writeFileSync(fullPath, updated, "utf8");
    console.log(`Applied fix: ${relativePath}`);
    audit.push({ ...entry, action: "applied" });
    touched.add(relativePath);
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
