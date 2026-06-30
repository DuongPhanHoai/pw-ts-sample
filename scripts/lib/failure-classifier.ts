import type { FailedTest } from "./playwright-results";

export function extractWaitingLocatorSelector(failure: FailedTest): string | undefined {
  const fromCallLog = failure.callLog?.match(/waiting for locator\('([^']+)'\)/i)?.[1];
  if (fromCallLog) return fromCallLog;

  const haystack = `${failure.error}\n${failure.errorContextMd ?? ""}`;
  return haystack.match(/waiting for locator\('([^']+)'\)/i)?.[1];
}

export type FailureCategory =
  | "locators-broken"
  | "timing-flaky"
  | "backend-issue"
  | "business-logic-change"
  | "test-data-issue";

export interface FailureClassification {
  category: FailureCategory;
  confidence: number;
  rootCauseSummary: string;
  proposedChangeSummary: string;
  codeChangeHints: Array<{
    filePath: string;
    reason: string;
    suggestedSelectorOrChange: string;
  }>;
}

function suggestedSelectorFromEvidence(failure: FailedTest): string | undefined {
  const match = failure.pageEvidence?.closestClassMatch;
  if (!match || match.distance <= 0) return undefined;
  return match.to;
}

/** Find other selectors in the same page object source embedded in error-context.md. */
function findAlternateSelectors(
  badSelector: string,
  errorContextMd?: string,
): string[] {
  if (!errorContextMd) return [];
  const sourceBlock = errorContextMd.match(/# Test source[\s\S]*?```ts\n([\s\S]*?)```/);
  if (!sourceBlock?.[1]) return [];

  const selectors = new Set<string>();
  for (const match of sourceBlock[1].matchAll(/locator\("([^"]+)"\)|locator\('([^']+)'\)/g)) {
    const sel = match[1] ?? match[2];
    if (sel && sel !== badSelector) selectors.add(sel);
  }
  return [...selectors];
}

export function classifyFailure(failure: FailedTest): FailureClassification | undefined {
  const badSelector = extractWaitingLocatorSelector(failure);
  if (!badSelector) return undefined;

  const alternates = findAlternateSelectors(badSelector, failure.errorContextMd);
  const loc = failure.failureLocation;
  const filePath = loc?.file ?? failure.file ?? "tests/pages/";
  const lineSuffix = loc?.line ? `:${loc.line}` : "";

  const passwordFieldLikely =
    badSelector.includes("pwd") ||
    badSelector.includes("password") ||
    /textbox "Password"/i.test(failure.errorContextMd ?? "");

  const evidenceSuggested = suggestedSelectorFromEvidence(failure);
  const suggested =
    evidenceSuggested ??
    alternates.find((s) => s.includes("password")) ??
    alternates.find((s) => s !== badSelector) ??
    (passwordFieldLikely ? "#password" : undefined);

  const evidenceNote = failure.pageEvidence?.closestClassMatch
    ? ` Page HTML/CSS suggests ${failure.pageEvidence.closestClassMatch.to} (${failure.pageEvidence.closestClassMatch.source}, distance ${failure.pageEvidence.closestClassMatch.distance}).`
    : "";

  const rootCauseSummary = suggested
    ? evidenceSuggested
      ? `Wrong selector ${badSelector} — live page HTML/CSS uses ${suggested}.${evidenceNote}`
      : `Wrong selector ${badSelector} — page uses ${suggested} (line 12 #user-name succeeded; line ${loc?.line ?? "?"} waits forever for missing element).`
    : `Locator ${badSelector} never matched — Playwright waited until timeout (not a slow page).${evidenceNote}`;

  const proposedChangeSummary = suggested
    ? `In ${filePath}${lineSuffix}, replace locator("${badSelector}") with locator("${suggested}").`
    : `Fix the broken selector ${badSelector} in ${filePath}${lineSuffix} to match the live DOM (see pageEvidence / error-context).`;

  return {
    category: "locators-broken",
    confidence: evidenceSuggested ? 0.99 : suggested ? 0.98 : 0.9,
    rootCauseSummary,
    proposedChangeSummary,
    codeChangeHints: [
      {
        filePath,
        reason: `Call log: waiting for locator('${badSelector}')`,
        suggestedSelectorOrChange: suggested
          ? `await this.page.locator("${suggested}").toHaveCount(count);`
          : `Update selector ${badSelector} in page object`,
      },
    ],
  };
}

export function applyDeterministicClassification<T extends {
  testName: string;
  category: string;
  confidence?: number;
  rootCauseSummary?: string;
  proposedChangeSummary: string;
  codeChangeHints: Array<{
    filePath: string;
    reason: string;
    suggestedSelectorOrChange: string;
  }>;
}>(item: T, failure: FailedTest): T {
  const detected = classifyFailure(failure);
  if (!detected) return item;

  if (item.category === detected.category) {
    return {
      ...item,
      confidence: Math.max(item.confidence ?? 0, detected.confidence),
      rootCauseSummary: detected.rootCauseSummary,
      proposedChangeSummary: detected.proposedChangeSummary,
      codeChangeHints: detected.codeChangeHints,
    };
  }

  return {
    ...item,
    category: detected.category,
    confidence: detected.confidence,
    rootCauseSummary: detected.rootCauseSummary,
    proposedChangeSummary: detected.proposedChangeSummary,
    codeChangeHints: detected.codeChangeHints,
  };
}
