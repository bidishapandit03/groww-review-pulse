import { Mistral } from "@mistralai/mistralai";

/**
 * Thin Mistral transport. Callers already pass REDACTED text; this layer only
 * handles auth, JSON mode and retry/backoff (429s get a longer cool-down).
 * Kept transport-only so pipeline logic stays testable without the network.
 */

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 1500;

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export function mistralClient(): Mistral {
  const key = process.env.MISTRAL_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "MISTRAL_API_KEY is not set — add it to .env.local (dev) or Vercel env (prod).",
    );
  }
  return new Mistral({ apiKey: key });
}

/** The chat content field can be a string or an array of content chunks. */
export function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) =>
        c && typeof c === "object" && "text" in c ? String((c as { text: string }).text) : "",
      )
      .join("");
  }
  return "";
}

export interface ChatCall {
  model: string;
  messages: ChatMessage[];
  /** request JSON-mode output (the prompt must still ask for JSON) */
  json?: boolean;
  maxAttempts?: number;
}

function isRateLimit(err: unknown): boolean {
  const e = err as { status?: number; statusCode?: number };
  return e.status === 429 || e.statusCode === 429;
}

export async function mistralChat(opts: ChatCall): Promise<string> {
  const attempts = opts.maxAttempts ?? MAX_ATTEMPTS;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await mistralClient().chat.complete({
        model: opts.model,
        messages: opts.messages,
        temperature: 0,
        ...(opts.json ? { responseFormat: { type: "json_object" as const } } : {}),
      });
      const text = messageText(res.choices?.[0]?.message?.content).trim();
      if (!text) throw new Error("Empty model response.");
      return text;
    } catch (err) {
      lastError = err;
      if (attempt < attempts) {
        const delay = BASE_DELAY_MS * attempt * (isRateLimit(err) ? 4 : 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`Mistral call failed: ${String(lastError)}`);
}