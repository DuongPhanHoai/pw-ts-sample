import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { chatText } from "./lib/llm";
import { classifyFailure } from "./lib/failure-classifier";
import { loadTestRun, type FailedTest } from "./lib/playwright-results";
import { paths, projectRoot } from "./lib/paths";

type AutoFixMode = "false" | "dry-run" | "true";

const FixPlanSchema = z.object({
  failureSnapshots: z.record(z.string(), z.unknown()).optional(),
  planLlm: z
    .array(
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
    )
    .optional(),
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

function extractSelectorFromHint(text: string): string | undefined {
  const clickBracket = text.match(/\.click\(\s*(\[[^\]]+\])\s*\)/)?.[1];
  if (clickBracket) return clickBracket.replace(/\\'/g, "'");

  const clickSingle = text.match(/\.click\(\s*'([^']+)'\s*\)/)?.[1];
  if (clickSingle) return clickSingle;

  const clickDouble = text.match(/\.click\(\s*"([^"]+)"\s*\)/)?.[1];
  if (clickDouble) return clickDouble;

  const fillSingle = text.match(/\.fill\(\s*'([^']+)'\s*,/)?.[1];
  if (fillSingle) return fillSingle;

  const fillDouble = text.match(/\.fill\(\s*"([^"]+)"\s*,/)?.[1];
  if (fillDouble) return fillDouble;

  if (/toHaveCount\s*\(/.test(text)) return undefined;

  const locatorBracket = text.match(/locator\(\s*(\[[^\]]+\])\s*\)/)?.[1];
  if (locatorBracket) return locatorBracket.replace(/\\'/g, "'");

  return text.match(/locator\(\s*["']([^"']+)["']\s*\)/)?.[1];
}

function extractSelectorFromReason(reason: string): string | undefined {
  const dataTest =
    reason.match(/data-test=["']([^"']+)["']/i)?.[1] ??
    reason.match(/data-test=\\["']([^"']+)\\["']/i)?.[1];
  if (dataTest) return `[data-test="${dataTest}"]`;

  const idMatch = reason.match(/\bid=["']([^"']+)["']/i)?.[1];
  if (idMatch) return `#${idMatch}`;

  const classMatch = reason.match(/\.([\w-]+)/)?.[1];
  if (classMatch && reason.includes("checkout_button")) return `.${classMatch}`;

  return undefined;
}

function extractNewSelector(summary: string, hintText: string, reason?: string): string | undefined {
  const fromHint = extractSelectorFromHint(hintText);
  if (fromHint) return fromHint;

  const fromReason = reason ? extractSelectorFromReason(reason) : undefined;
  if (fromReason) return fromReason;

  const bracketMatch = summary.match(/\[(data-test[^\]]+)\]/i);
  if (bracketMatch) return `[${bracketMatch[1]}]`;

  const bracketMatch2 = summary.match(/\bwith (\[[^\]]+\])/i);
  if (bracketMatch2) return bracketMatch2[1];

  const idMatch = summary.match(/\bwith (#[\w-]+)/i);
  if (idMatch) return idMatch[1];

  const classMatch = summary.match(/\bwith (\.[\w-]+)/i);
  if (classMatch) return classMatch[1];

  const clickInSummary = summary.match(/\.click\(\s*(\[[^\]]+\])\s*\)/)?.[1];
  if (clickInSummary) return clickInSummary;

  return undefined;
}

function extractOldSelector(reason: string, summary: string): string | undefined {
  const fromReason =
    reason.match(/waiting for locator\('([^']+)'\)/i)?.[1] ??
    reason.match(/waiting for locator\("([^"]+)"\)/i)?.[1];
  if (fromReason) return fromReason;

  const fromSummary =
    summary.match(/replace (#\S+|\[[^\]]+\]|\.[\w-]+|\S+) with/i)?.[1] ??
    summary.match(/locator\(["']([^"']+)["']\)/i)?.[1];
  return fromSummary;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getSelectorOnLine(content: string, line: number): string | undefined {
  const lines = content.split(/\r?\n/);
  const idx = line - 1;
  if (idx < 0 || idx >= lines.length) return undefined;
  const match = lines[idx].match(
    /\.(?:click|fill|locator|dblclick|press)\(\s*(["'`])([^"'`]+)\1/,
  );
  return match?.[2];
}

function selectorsEquivalent(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const norm = (s: string) => s.replace(/^#/, "").replace(/^\[data-test="([^"]+)"\]$/, "$1");
  return norm(a) === norm(b);
}

function isStaleHint(hintText: string): boolean {
  return /toHaveCount\s*\(/.test(hintText);
}

function isUnsafeReplacement(
  content: string,
  newSelector: string,
  failureLine?: number,
): boolean {
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    if (failureLine && lineNo === failureLine) continue;
    const line = lines[i];
    if (!line.includes(newSelector)) continue;
    if (/\.(?:click|fill|dblclick|press)\(/.test(line)) continue;
    if (/expect\(|toBeVisible|toHaveText|toHaveCount/.test(line)) return true;
  }
  return false;
}

function replaceSelectorInSource(
  content: string,
  oldSelector: string,
  newSelector: string,
  failureLine?: number,
): string | null {
  if (!oldSelector || !newSelector || oldSelector === newSelector) return null;

  if (failureLine !== undefined && failureLine > 0) {
    const lines = content.split(/\r?\n/);
    const idx = failureLine - 1;
    if (idx >= 0 && idx < lines.length) {
      const line = lines[idx];
      const actionMatch = line.match(
        /(\.(?:click|fill|locator|dblclick|press)\(\s*)(["'`])([^"'`]+)\2/,
      );
      if (actionMatch && actionMatch[3] !== newSelector) {
        const updatedLine = line.replace(
          new RegExp(
            `(\\.(?:click|fill|locator|dblclick|press)\\(\\s*)${escapeRegExp(actionMatch[2])}${escapeRegExp(actionMatch[3])}${escapeRegExp(actionMatch[2])}`,
          ),
          `$1${actionMatch[2]}${newSelector}${actionMatch[2]}`,
        );
        if (updatedLine !== line) {
          lines[idx] = updatedLine;
          return lines.join("\n");
        }
      }
    }
  }

  let updated = content;
  for (const quote of ['"', "'", "`"] as const) {
    const from = `${quote}${oldSelector}${quote}`;
    const to = `${quote}${newSelector}${quote}`;
    if (updated.includes(from)) {
      return updated.replace(from, to);
    }
  }

  return null;
}

type PlanItem = z.infer<typeof FixPlanSchema>["plan"][number];

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

function isStalePlanItem(item: PlanItem): boolean {
  const hint = item.codeChangeHints[0]?.suggestedSelectorOrChange ?? "";
  return isStaleHint(hint) || /\.summary_info/.test(item.proposedChangeSummary);
}

function pickApplyPlanItem(
  rawItem: PlanItem,
  planLlmByTest: Map<string, PlanItem>,
  planLlmByFile: Map<string, PlanItem>,
  relativePath: string,
): PlanItem {
  const llmItem = planLlmByTest.get(rawItem.testName) ?? planLlmByFile.get(relativePath);
  if (llmItem && isStalePlanItem(rawItem)) {
    return llmItem;
  }
  return llmItem && !isStalePlanItem(llmItem) ? llmItem : rawItem;
}

function revalidatePlanItem(item: PlanItem, failure?: FailedTest): PlanItem {
  if (!failure) return item;

  const detected = classifyFailure(failure);
  if (!detected || detected.evidenceStrength !== "strong") return item;

  logApply("re-validated from failure evidence", {
    testName: item.testName,
    was: item.proposedChangeSummary,
    now: detected.proposedChangeSummary,
    hint: detected.codeChangeHints[0]?.suggestedSelectorOrChange,
  });
  return {
    ...item,
    category: detected.category,
    confidence: Math.max(item.confidence ?? 0, detected.confidence),
    proposedChangeSummary: detected.proposedChangeSummary,
    codeChangeHints: detected.codeChangeHints,
  };
}

function tryDeterministicLocatorFix(input: {
  original: string;
  category: string;
  proposedChangeSummary: string;
  hint: { reason: string; suggestedSelectorOrChange: string };
  failureLine?: number;
}): string | null {
  if (input.category !== "locators-broken") return null;

  const oldSelector = extractOldSelector(input.hint.reason, input.proposedChangeSummary);
  const newSelector = extractNewSelector(
    input.proposedChangeSummary,
    input.hint.suggestedSelectorOrChange,
    input.hint.reason,
  );
  if (!oldSelector || !newSelector) return null;
  if (isUnsafeReplacement(input.original, newSelector, input.failureLine)) return null;

  return replaceSelectorInSource(
    input.original,
    oldSelector,
    newSelector,
    input.failureLine,
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
  const fixPlanRaw = JSON.parse(fs.readFileSync(paths.aiFixPlan, "utf8"));
  const fixPlan = FixPlanSchema.parse(fixPlanRaw);
  const snapshots = fixPlan.failureSnapshots ?? {};
  const planLlmItems = fixPlan.planLlm ?? [];
  const planLlmByTest = new Map(planLlmItems.map((p) => [p.testName, p]));
  const planLlmByFile = new Map(
    planLlmItems.map((p) => [normalizeRelativePath(p.codeChangeHints[0]?.filePath ?? ""), p]),
  );

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

  const seenFiles = new Set<string>();
  const uniqueCandidates = candidates.filter((item) => {
    const file = normalizeRelativePath(item.codeChangeHints[0]?.filePath ?? "");
    if (!file || seenFiles.has(file)) return false;
    seenFiles.add(file);
    return true;
  });

  console.log(
    `Apply targets: ${uniqueCandidates.length} fix group(s) from ${candidates.length} plan row(s)`,
  );

  const touched = new Set<string>();
  const audit: unknown[] = [];

  for (const rawItem of uniqueCandidates) {
    if (touched.size >= maxFiles) break;

    const relativePathEarly = normalizeRelativePath(rawItem.codeChangeHints[0].filePath);
    const sourceItem = pickApplyPlanItem(
      rawItem,
      planLlmByTest,
      planLlmByFile,
      relativePathEarly,
    );

    const failure = mergeFailure(
      failuresByTestName.get(sourceItem.testName) ??
        failuresByTestName.get(rawItem.testName),
      asFailedTest(snapshots[sourceItem.testName] ?? snapshots[rawItem.testName]),
    );
    const item = revalidatePlanItem(sourceItem, failure);
    const hint = item.codeChangeHints[0];
    const relativePath = normalizeRelativePath(hint.filePath);

    logApply("candidate", {
      testName: item.testName,
      file: relativePath,
      category: item.category,
      confidence: item.confidence,
      planSource: sourceItem !== rawItem ? "planLlm" : "plan",
      planFromFile: rawItem.proposedChangeSummary,
      planUsed: item.proposedChangeSummary,
      hintReason: hint.reason,
      hintSuggested: hint.suggestedSelectorOrChange,
      failureSource: failure
        ? failuresByTestName.has(sourceItem.testName)
          ? "results.json+snapshot"
          : "ai-fix-plan.failureSnapshots"
        : "none",
      failureLine: failure?.failureLocation?.line,
    });

    if (touched.has(relativePath)) {
      logApply("skip", { reason: "file already touched this run", file: relativePath });
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
    const failureLine = failure?.failureLocation?.line;
    const oldSelector = extractOldSelector(hint.reason, item.proposedChangeSummary);
    const newSelector = extractNewSelector(
      item.proposedChangeSummary,
      hint.suggestedSelectorOrChange,
      hint.reason,
    );
    const currentOnLine =
      failureLine !== undefined ? getSelectorOnLine(original, failureLine) : undefined;

    logApply("selectors parsed", {
      oldSelector,
      newSelector,
      currentOnLine: currentOnLine ?? "(unknown)",
      staleHint: isStaleHint(hint.suggestedSelectorOrChange),
    });

    if (
      newSelector &&
      currentOnLine &&
      selectorsEquivalent(currentOnLine, newSelector)
    ) {
      logApply("skip", {
        reason: "already fixed on failure line",
        file: `${relativePath}:${failureLine}`,
        selector: currentOnLine,
      });
      touched.add(relativePath);
      continue;
    }

    const hasStrongEvidence =
      failure !== undefined &&
      classifyFailure(failure)?.evidenceStrength === "strong";

    logApply("evidence", {
      hasStrongEvidence,
      hasFailureSnapshot: failure !== undefined,
    });

    if (!hasStrongEvidence && isStalePlanItem(item)) {
      logApply("skip", {
        reason: "stale fix plan and no strong DOM evidence to re-validate",
        action: "re-run: npx playwright test && npm run analyze:results",
      });
      continue;
    }

    if (
      newSelector &&
      isUnsafeReplacement(original, newSelector, failureLine)
    ) {
      logApply("skip", {
        reason: "unsafe replacement — selector used on assertion line elsewhere",
        newSelector,
        failureLine,
      });
      continue;
    }

    let updated: string | null = tryDeterministicLocatorFix({
      original,
      category: item.category,
      proposedChangeSummary: item.proposedChangeSummary,
      hint,
      failureLine,
    });
    let applyMethod: "deterministic" | "llm" = "deterministic";

    if (
      !updated &&
      failureLine &&
      newSelector &&
      currentOnLine &&
      !selectorsEquivalent(currentOnLine, newSelector)
    ) {
      updated = replaceSelectorInSource(
        original,
        currentOnLine,
        newSelector,
        failureLine,
      );
      if (updated) {
        logApply("deterministic line fix", {
          file: `${relativePath}:${failureLine}`,
          from: currentOnLine,
          to: newSelector,
        });
      }
    } else if (updated) {
      logApply("deterministic selector fix", {
        file: relativePath,
        from: oldSelector,
        to: newSelector,
      });
    }

    if (!updated && hasStrongEvidence) {
      logApply("skip", {
        reason: "could not apply deterministic fix despite strong evidence",
        oldSelector,
        newSelector,
        currentOnLine,
      });
      continue;
    }

    if (!updated) {
      applyMethod = "llm";
      logApply("llm fallback", {
        file: relativePath,
        brokenSelector: oldSelector,
        replacementSelector: newSelector,
        proposedChangeSummary: item.proposedChangeSummary,
      });
      const system =
        "You are an expert Playwright + TypeScript test engineer. Return ONLY the full updated file content. No markdown fences.";
      const user = JSON.stringify(
        {
          task: "Apply ONE minimal locator fix. Change only the broken selector; do not rewrite unrelated lines.",
          testName: item.testName,
          category: item.category,
          proposedChangeSummary: item.proposedChangeSummary,
          brokenSelector: oldSelector,
          replacementSelector: newSelector,
          hint,
          filePath: relativePath,
          rules: [
            "Replace ONLY occurrences of brokenSelector with replacementSelector.",
            "Do NOT substitute a different element from later steps in the same method.",
            "Keep imports, method order, and all other selectors unchanged.",
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
      updated = result.content;
    }

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
      applyMethod,
      oldSelector,
      newSelector,
      selectorOnLineBefore: currentOnLine,
      proposedChangeSummary: item.proposedChangeSummary,
      planFromFile: rawItem.proposedChangeSummary,
      at: new Date().toISOString(),
    };

    if (mode === "dry-run") {
      logApply("dry-run would write", {
        file: relativePath,
        method: applyMethod,
        chars: `${original.length} → ${updated.length}`,
      });
      audit.push({ ...entry, action: "dry-run" });
      touched.add(relativePath);
      continue;
    }

    fs.writeFileSync(fullPath, updated, "utf8");
    logApply("applied", { file: relativePath, method: applyMethod });
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
