import OpenAI from "openai";
import { logLlmExchange } from "./llm-log";
import type { TokenUsageFromApi } from "./token-estimate";

function getTimeoutMs(): number {
  const seconds = Number(process.env.LMSTUDIO_TIMEOUT_SECONDS ?? 60);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60_000;
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

/** LM Studio supports response_format type "text" or "json_schema", not OpenAI's json_object. */
export function parseJsonFromLlm(content: string): unknown {
  const trimmed = content.trim();
  if (!trimmed) return {};

  try {
    return JSON.parse(trimmed);
  } catch {
    // ```json ... ``` or ``` ... ```
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      return JSON.parse(fenced[1].trim());
    }

    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
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

export async function chatJson(
  system: string,
  user: string,
  options?: ChatOptions,
): Promise<ChatResult> {
  const jsonSystem = `${system}\n\nReturn ONLY valid JSON. No markdown fences, no commentary.`;
  const result = await chatText(jsonSystem, user, {
    ...options,
    meta: { ...options?.meta, responseFormat: "json" },
  });
  const parsed = parseJsonFromLlm(result.content);
  return {
    content: JSON.stringify(parsed),
    usage: result.usage,
  };
}

export async function chatText(
  system: string,
  user: string,
  options?: ChatOptions,
): Promise<ChatResult> {
  const client = createLlmClient();
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
    label: options?.label ?? nextAutoLabel(),
    system,
    user,
    response: content,
    usage,
    meta: {
      model: getModel(),
      ...options?.meta,
    },
  });

  return { content, usage };
}
