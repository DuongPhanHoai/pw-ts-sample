import { findDomSelectorReplacement } from "./page-evidence";
import type { FailedTest } from "./playwright-results";
import { formatClickSnippet } from "./selector-quotes";

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

export type EvidenceStrength = "strong" | "none";

export interface FailureClassification {
  category: FailureCategory;
  confidence: number;
  evidenceStrength: EvidenceStrength;
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

function suggestedSelectorFromDom(
  badSelector: string,
  failure: FailedTest,
): string | undefined {
  return findDomSelectorReplacement(
    badSelector,
    failure.pageEvidence?.domExcerpt,
    failure.errorContextMd,
  );
}

function findAlternateSelectors(
  badSelector: string,
  errorContextMd?: string,
): string[] {
  if (!badSelector.trim().startsWith(".")) return [];
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

  const loc = failure.failureLocation;
  const filePath = loc?.file ?? failure.file ?? "tests/pages/";
  const lineSuffix = loc?.line ? `:${loc.line}` : "";

  const passwordFieldLikely =
    badSelector.includes("pwd") ||
    badSelector.includes("password") ||
    /textbox "Password"/i.test(failure.errorContextMd ?? "");

  const evidenceSuggested = suggestedSelectorFromEvidence(failure);
  const domSuggested = suggestedSelectorFromDom(badSelector, failure);
  const alternates = findAlternateSelectors(badSelector, failure.errorContextMd);

  const suggested =
    evidenceSuggested ??
    domSuggested ??
    alternates.find((s) => s.includes("password")) ??
    (passwordFieldLikely ? "#password" : undefined);

  const evidenceStrength: EvidenceStrength =
    evidenceSuggested || domSuggested || passwordFieldLikely ? "strong" : "none";

  if (!suggested) {
    const evidenceNote = failure.pageEvidence?.closestClassMatch
      ? ` Page HTML/CSS suggests ${failure.pageEvidence.closestClassMatch.to}.`
      : "";
    return {
      category: "locators-broken",
      confidence: 0.9,
      evidenceStrength: "none",
      rootCauseSummary: `Locator ${badSelector} never matched — Playwright waited until timeout.${evidenceNote}`,
      proposedChangeSummary: `Fix the broken selector ${badSelector} in ${filePath}${lineSuffix} to match the live DOM (see pageEvidence / error-context).`,
      codeChangeHints: [
        {
          filePath,
          reason: `Call log: waiting for locator('${badSelector}')`,
          suggestedSelectorOrChange: `Update selector ${badSelector} in page object`,
        },
      ],
    };
  }

  const evidenceNote = domSuggested
    ? ` Live DOM uses ${domSuggested}.`
    : evidenceSuggested
      ? ` Page HTML/CSS suggests ${evidenceSuggested}.`
      : "";

  return {
    category: "locators-broken",
    confidence: evidenceSuggested || domSuggested ? 0.99 : 0.98,
    evidenceStrength,
    rootCauseSummary: `Wrong selector ${badSelector} — page uses ${suggested}.${evidenceNote}`,
    proposedChangeSummary: `In ${filePath}${lineSuffix}, replace ${badSelector} with ${suggested}.`,
    codeChangeHints: [
      {
        filePath,
        reason: `Call log: waiting for locator('${badSelector}')`,
        suggestedSelectorOrChange: formatClickSnippet(
          suggested,
          failure.errorContextMd,
        ),
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
  if (!detected || detected.evidenceStrength !== "strong") return item;

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
