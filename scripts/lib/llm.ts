import OpenAI from "openai";

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

export async function chatJson(system: string, user: string): Promise<string> {
  const client = createLlmClient();
  const response = await client.chat.completions.create({
    model: getModel(),
    temperature: 0.2,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
  });

  return response.choices[0]?.message?.content ?? "{}";
}

export async function chatText(system: string, user: string): Promise<string> {
  const client = createLlmClient();
  const response = await client.chat.completions.create({
    model: getModel(),
    temperature: 0.2,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  return response.choices[0]?.message?.content ?? "";
}
