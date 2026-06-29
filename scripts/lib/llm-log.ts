import fs from "node:fs";
import path from "node:path";
import type { TokenUsageFromApi } from "./token-estimate";
import { paths } from "./paths";

export function shouldLogLlmPrompts(): boolean {
  const v = (process.env.LMSTUDIO_LOG_PROMPTS ?? "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function getFailureLimit(): number | undefined {
  const raw = process.env.LMSTUDIO_FAILURE_LIMIT;
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.floor(n);
}

function safeLogFileName(label: string): string {
  return label.replace(/[^\w.-]+/g, "_").slice(0, 80);
}

export function getLlmLogFilePath(label: string): string {
  const dir = path.join(path.dirname(paths.resultsJson), "llm-prompts");
  return path.join(dir, `${safeLogFileName(label)}.txt`);
}

export interface LlmExchangeLog {
  label: string;
  system: string;
  user: string;
  response: string;
  meta?: Record<string, unknown>;
  usage?: TokenUsageFromApi;
}

/** Log full prompt + LLM response to reports/llm-prompts/ when LMSTUDIO_LOG_PROMPTS=true. */
export function logLlmExchange(input: LlmExchangeLog): string | undefined {
  if (!shouldLogLlmPrompts()) return undefined;

  const dir = path.join(path.dirname(paths.resultsJson), "llm-prompts");
  fs.mkdirSync(dir, { recursive: true });

  const filePath = getLlmLogFilePath(input.label);
  const metaLines = input.meta
    ? Object.entries(input.meta)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n")
    : "";

  const usageLines = input.usage
    ? [
        `promptTokens: ${input.usage.promptTokens}`,
        `completionTokens: ${input.usage.completionTokens}`,
        `totalTokens: ${input.usage.totalTokens}`,
      ].join("\n")
    : "";

  const header = [`=== ${input.label} ===`, metaLines, usageLines].filter(Boolean).join("\n");

  const body = `${header}\n\n--- SYSTEM ---\n${input.system}\n\n--- USER ---\n${input.user}\n\n--- ASSISTANT ---\n${input.response}\n`;
  fs.writeFileSync(filePath, body, "utf8");

  console.log("\n" + "=".repeat(72));
  console.log(`LLM EXCHANGE: ${input.label}`);
  if (input.meta) console.log(input.meta);
  if (input.usage) console.log(input.usage);
  console.log("-".repeat(72));
  console.log("--- SYSTEM (first 500 chars) ---");
  console.log(
    input.system.slice(0, 500) + (input.system.length > 500 ? "\n… [truncated in console]" : ""),
  );
  console.log("-".repeat(72));
  console.log("--- USER (full payload sent to model) ---");
  console.log(input.user);
  console.log("-".repeat(72));
  console.log("--- ASSISTANT (full response) ---");
  console.log(
    input.response.slice(0, 2000) +
      (input.response.length > 2000 ? "\n… [truncated in console — see file for full response]" : ""),
  );
  console.log("-".repeat(72));
  console.log(`Saved full exchange: ${filePath}\n`);

  return filePath;
}
