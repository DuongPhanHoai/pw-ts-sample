import OpenAI from "openai";
import { logLlmExchange } from "./llm-log";
import type { TokenUsageFromApi } from "./token-estimate";

function getTimeoutMs(): number {
  const seconds = Number(process.env.LMSTUDIO_TIMEOUT_SECONDS ?? 60);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60_000;
}

/** Total attempts per LLM call (first try + retries). Default 3. */
export function getLlmMaxAttempts(): number {
  const raw =
    process.env.LMSTUDIO_LLM_MAX_ATTEMPTS ?? process.env.LMSTUDIO_LLM_RETRIES ?? "3";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3;
}

function getRetryDelayMs(attempt: number): number {
  const base = Number(process.env.LMSTUDIO_LLM_RETRY_DELAY_MS ?? 1500);
  const ms = Number.isFinite(base) && base >= 0 ? base : 1500;
  return ms * attempt;
}

export function createLlmClient(): OpenAI {
  const baseURL = process.env.LMSTUDIO_BASE_URL ?? "http://192.168.1.166:1234/v1";
  const apiKey = process.env.LMSTUDIO_API_KEY ?? "lm-studio";

  return new OpenAI({
    baseURL,
    apiKey,
    timeout: getTimeoutMs(),
  });
}

export function getModel(): string {
  return process.env.LMSTUDIO_MODEL ?? "google/gemma-4-e4b";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isRetryableTransportError(err: unknown): boolean {
  if (!(err instanceof Error)) return true;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("network") ||
    msg.includes("fetch failed") ||
    msg.includes("socket") ||
    msg.includes("503") ||
    msg.includes("502") ||
    msg.includes("429")
  );
}

function isInvalidJsonError(err: unknown): boolean {
  return err instanceof Error && err.message.includes("valid JSON");
}

/** LM Studio supports response_format type "text" or "json_schema", not OpenAI's json_object. */
export function parseJsonFromLlm(content: string): unknown {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("LLM response did not contain valid JSON (empty response)");
  }

  const tryParse = (text: string): unknown => {
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new Error(
        `LLM response did not contain valid JSON${err instanceof SyntaxError ? `: ${err.message}` : ""}`,
      );
    }
  };

  try {
    return tryParse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      return tryParse(fenced[1].trim());
    }

    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return tryParse(trimmed.slice(start, end + 1));
    }

    throw new Error("LLM response did not contain valid JSON");
  }
}

export interface ChatResult {
  content: string;
  usage?: TokenUsageFromApi;
}

export interface ChatOptions {
  /** File label under reports/llm-prompts/ (auto-generated if omitted). */
  label?: string;
  meta?: Record<string, unknown>;
}

let autoCallIndex = 0;

function nextAutoLabel(): string {
  autoCallIndex += 1;
  return `llm-call-${autoCallIndex}`;
}

function readUsage(response: OpenAI.Chat.Completions.ChatCompletion): TokenUsageFromApi | undefined {
  const u = response.usage;
  if (!u) return undefined;
  const promptTokens = u.prompt_tokens ?? 0;
  const completionTokens = u.completion_tokens ?? 0;
  const totalTokens = u.total_tokens ?? promptTokens + completionTokens;
  if (totalTokens <= 0) return undefined;
  return { promptTokens, completionTokens, totalTokens };
}

function labelForAttempt(baseLabel: string, attempt: number): string {
  if (attempt <= 1) return baseLabel;
  return `${baseLabel}-retry-${attempt}`;
}

async function completeChat(
  system: string,
  user: string,
  options: ChatOptions | undefined,
  attempt: number,
): Promise<ChatResult> {
  const client = createLlmClient();
  const baseLabel = options?.label ?? nextAutoLabel();

  const response = await client.chat.completions.create({
    model: getModel(),
    temperature: 0.2,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const content = response.choices[0]?.message?.content ?? "";
  const usage = readUsage(response);

  logLlmExchange({
    label: labelForAttempt(baseLabel, attempt),
    system,
    user,
    response: content,
    usage,
    meta: {
      model: getModel(),
      attempt,
      maxAttempts: getLlmMaxAttempts(),
      ...options?.meta,
    },
  });

  if (!content.trim()) {
    throw new Error("LLM returned empty response");
  }

  return { content, usage };
}

function logRetry(label: string, attempt: number, maxAttempts: number, reason: string): void {
  console.warn(
    `LLM retry ${attempt + 1}/${maxAttempts} for ${label}: ${reason}`,
  );
}

const JSON_RETRY_SYSTEM =
  "\n\nIMPORTANT: Your previous response was missing, truncated, or invalid JSON. " +
  "Return ONE complete valid JSON value only. No markdown fences, no commentary before or after.";

export async function chatJson(
  system: string,
  user: string,
  options?: ChatOptions,
): Promise<ChatResult> {
  const maxAttempts = getLlmMaxAttempts();
  const baseLabel = options?.label ?? nextAutoLabel();
  const jsonSystemBase = `${system}\n\nReturn ONLY valid JSON. No markdown fences, no commentary.`;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const systemPrompt =
      attempt === 1 ? jsonSystemBase : `${jsonSystemBase}${JSON_RETRY_SYSTEM}`;

    try {
      const result = await completeChat(systemPrompt, user, options, attempt);
      const parsed = parseJsonFromLlm(result.content);
      return {
        content: JSON.stringify(parsed),
        usage: result.usage,
      };
    } catch (err) {
      lastError = err;
      const retryable =
        isInvalidJsonError(err) ||
        isRetryableTransportError(err) ||
        errMessage(err).includes("empty response");

      if (attempt < maxAttempts && retryable) {
        logRetry(baseLabel, attempt, maxAttempts, errMessage(err));
        await sleep(getRetryDelayMs(attempt));
        continue;
      }
      throw err;
    }
  }

  throw lastError ?? new Error("LLM JSON request failed");
}

export async function chatText(
  system: string,
  user: string,
  options?: ChatOptions,
): Promise<ChatResult> {
  const maxAttempts = getLlmMaxAttempts();
  const baseLabel = options?.label ?? nextAutoLabel();

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const systemPrompt =
      attempt === 1
        ? system
        : `${system}\n\nIMPORTANT: Your previous response failed (${errMessage(lastError)}). Try again and follow the instructions exactly.`;

    try {
      return await completeChat(systemPrompt, user, options, attempt);
    } catch (err) {
      lastError = err;
      const retryable =
        isRetryableTransportError(err) || errMessage(err).includes("empty response");

      if (attempt < maxAttempts && retryable) {
        logRetry(baseLabel, attempt, maxAttempts, errMessage(err));
        await sleep(getRetryDelayMs(attempt));
        continue;
      }
      throw err;
    }
  }

  throw lastError ?? new Error("LLM text request failed");
}
