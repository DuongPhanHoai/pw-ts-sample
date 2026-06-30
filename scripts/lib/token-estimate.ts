/** Rough token count (~4 chars/token). Good enough for local LM Studio cost planning. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export interface TokenUsageFromApi {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface TokenCallRecord {
  label: string;
  type: "fix-plan" | "failure-triage" | "analysis" | "executive-summary" | "synthesis" | "other";
  testName?: string;
  estimatedInputTokens: number;
  estimatedOutputTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  source: "estimated" | "api" | "mixed";
}

export function getCostPer1MInput(): number | undefined {
  const n = Number(process.env.LMSTUDIO_COST_PER_1M_INPUT);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function getCostPer1MOutput(): number | undefined {
  const n = Number(process.env.LMSTUDIO_COST_PER_1M_OUTPUT);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function estimateCostUsd(
  inputTokens: number,
  outputTokens: number,
): number | undefined {
  const inPrice = getCostPer1MInput();
  const outPrice = getCostPer1MOutput();
  if (inPrice === undefined || outPrice === undefined) return undefined;
  return (inputTokens / 1_000_000) * inPrice + (outputTokens / 1_000_000) * outPrice;
}

export function mergeApiUsage(
  estimatedInput: number,
  api?: TokenUsageFromApi,
): Pick<TokenCallRecord, "promptTokens" | "completionTokens" | "totalTokens" | "source"> {
  if (!api || api.totalTokens <= 0) {
    return { source: "estimated" };
  }
  return {
    promptTokens: api.promptTokens,
    completionTokens: api.completionTokens,
    totalTokens: api.totalTokens,
    source: "api",
  };
}

export function summarizeTokenRecords(calls: TokenCallRecord[]): {
  callCount: number;
  estimatedInputTokens: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
  actualCostUsd?: number;
  hasApiUsage: boolean;
} {
  let estimatedInputTokens = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let hasApiUsage = false;

  for (const call of calls) {
    estimatedInputTokens += call.estimatedInputTokens;
    if (call.promptTokens !== undefined) {
      promptTokens += call.promptTokens;
      completionTokens += call.completionTokens ?? 0;
      hasApiUsage = true;
    }
  }

  const totalTokens = promptTokens + completionTokens;
  const estimatedOutputGuess = calls.reduce(
    (sum, c) => sum + (c.estimatedOutputTokens ?? 0),
    0,
  );

  return {
    callCount: calls.length,
    estimatedInputTokens,
    promptTokens,
    completionTokens,
    totalTokens: hasApiUsage ? totalTokens : estimatedInputTokens + estimatedOutputGuess,
    estimatedCostUsd: estimateCostUsd(estimatedInputTokens, estimatedOutputGuess),
    actualCostUsd: hasApiUsage ? estimateCostUsd(promptTokens, completionTokens) : undefined,
    hasApiUsage,
  };
}

export function formatTokenSummary(summary: ReturnType<typeof summarizeTokenRecords>): string {
  const lines = [
    `LLM calls: ${summary.callCount}`,
    `Estimated input tokens: ~${summary.estimatedInputTokens.toLocaleString()}`,
  ];

  if (summary.hasApiUsage) {
    lines.push(
      `Actual prompt tokens: ${summary.promptTokens.toLocaleString()}`,
      `Actual completion tokens: ${summary.completionTokens.toLocaleString()}`,
      `Actual total tokens: ${summary.totalTokens.toLocaleString()}`,
    );
  } else {
    lines.push(
      `Estimated total tokens (in + ~out): ~${summary.totalTokens.toLocaleString()} (API usage not returned — LM Studio estimate)`,
    );
  }

  if (summary.actualCostUsd !== undefined) {
    lines.push(`Estimated cost (actual usage): $${summary.actualCostUsd.toFixed(4)} USD`);
  } else if (summary.estimatedCostUsd !== undefined) {
    lines.push(`Estimated cost (rough): $${summary.estimatedCostUsd.toFixed(4)} USD`);
  } else {
    lines.push(
      "Cost: set LMSTUDIO_COST_PER_1M_INPUT and LMSTUDIO_COST_PER_1M_OUTPUT in .env for USD estimates",
    );
  }

  return lines.join("\n");
}
