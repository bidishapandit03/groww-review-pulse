import { readFile } from "node:fs/promises";
import path from "node:path";
import { MISTRAL_TAG_MODEL } from "@/lib/constants";
import { mistralChat } from "@/lib/llm";
import { redactReviews } from "@/lib/redact";
import { tagThemeSchema } from "@/lib/types";
import type { Review, TagTheme, TaggedReview } from "@/lib/types";
import { z } from "zod";

/**
 * Phase 5: assign each review EXACTLY one theme using Mistral.
 * Guardrails:
 *   - Redaction happens HERE, inside the tag path, before any prompt is built —
 *     the LLM never sees raw text no matter who calls (PRD FR2).
 *   - Every returned theme is validated against the fixed legend with zod;
 *     a malformed response fails the batch loudly (never silently mislabels).
 */

export const TAG_BATCH_SIZE = 40;
export const TAG_PROMPT_PATH = path.join(process.cwd(), "prompts/tag_themes.txt");

export function chunkReviews<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** One index-prefixed line per review; title included when present. */
function tagLine(review: Review, index: number): string {
  const text = review.text.replace(/\s+/g, " ").trim();
  const title = review.title.replace(/\s+/g, " ").trim();
  return title ? `${index}. [${title}] ${text}` : `${index}. ${text}`;
}

/** Build the user message a batch of REDACTED reviews; returns review lines. */
export function buildTagLines(batch: Review[]): string[] {
  return redactReviews(batch).map((r, i) => tagLine(r, i));
}

const valueSchema = z.record(z.string(), tagThemeSchema);

/** Extract the JSON object from a (possibly fenced) model reply. */
export function extractJson(raw: string): unknown {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1]!.trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`No JSON object found in model reply: ${raw.slice(0, 120)}`);
  }
  return JSON.parse(text.slice(start, end + 1));
}

/** Validate the model's JSON into { lineIndex: theme }. */
export function parseTagResponse(raw: string): Record<string, TagTheme> {
  const parsed = valueSchema.safeParse(extractJson(raw));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Tag response failed validation: ${issues}`);
  }
  return parsed.data as Record<string, TagTheme>;
}

export type LlmCall = (prompt: string) => Promise<string>;

/** Tag one redacted batch given a template and an LLM transport. */
export async function tagBatch(
  batch: Review[],
  template: string,
  llm: LlmCall,
): Promise<TaggedReview[]> {
  const redacted = redactReviews(batch);
  const lines = redacted.map((r, i) => tagLine(r, i));
  const prompt = template.replace("{{reviews}}", lines.join("\n"));
  const parsed = parseTagResponse(await llm(prompt));
  return redacted.map((review, index) => {
    const theme = parsed[String(index)];
    if (!theme) throw new Error(`Tag response missing line ${index}.`);
    return { ...review, theme };
  });
}

async function defaultTemplate(): Promise<string> {
  return readFile(TAG_PROMPT_PATH, "utf8");
}

export interface TagOptions {
  model?: string;
  batchSize?: number;
  /** pause between batches to avoid 429s */
  delayMs?: number;
  promptTemplate?: string;
}

/** Tag an arbitrary list of reviews. Redacts internally; validates every theme. */
export async function tagReviews(
  reviews: Review[],
  opts: TagOptions = {},
): Promise<TaggedReview[]> {
  const model = opts.model ?? MISTRAL_TAG_MODEL;
  const batchSize = opts.batchSize ?? TAG_BATCH_SIZE;
  const delayMs = opts.delayMs ?? 250;
  const template = opts.promptTemplate ?? (await defaultTemplate());
  const llm: LlmCall = async (prompt) =>
    mistralChat({
      model,
      messages: [{ role: "system", content: prompt }],
      json: true,
    });

  const chunks = chunkReviews(reviews, batchSize);
  const tagged: TaggedReview[] = [];
  for (let i = 0; i < chunks.length; i += 1) {
    tagged.push(...(await tagBatch(chunks[i]!, template, llm)));
    if (i < chunks.length - 1 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return tagged;
}