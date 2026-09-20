import { readFile } from "node:fs/promises";
import path from "node:path";
import { MAX_NOTE_WORDS, MISTRAL_NOTE_MODEL, THEMES } from "@/lib/constants";
import { isoYearWeek } from "@/lib/dates";
import { mistralChat } from "@/lib/llm";
import { wordCount } from "@/lib/pipeline/aggregate";
import { extractJson } from "@/lib/pipeline/tag";
import type { AggregateResult, CandidateQuote } from "@/lib/pipeline/types";
import { containsPii } from "@/lib/redact";
import type { Note, NoteAction, TagTheme, ThemeSummary } from "@/lib/types";
import { noteActionSchema, themeSummarySchema } from "@/lib/types";
import { z } from "zod";

/**
 * Phase 7: turn the aggregate into a validated, <=250-word weekly note.
 * Guardrails (PRD FR3/FR4):
 *   - The LLM writes prose and SELECTS quote ids; code inserts the exact quote
 *     text, so quotes are always verbatim and proven to exist in the corpus.
 *   - Everything exact (counts, ratings, WoW, word count) comes from code.
 *   - The draft is validated with zod + rule checks; on failure it retries once
 *     with the error text before surfacing a pipeline failure.
 */

export const NOTE_PROMPT_PATH = path.join(process.cwd(), "prompts/write_note.txt");

const noteDraftSchema = z.object({
  weekLabel: z.string().min(1),
  themes: z.array(themeSummarySchema).length(3),
  quoteIds: z.array(z.string().min(1)).length(3),
  actions: z.array(noteActionSchema).length(3),
});
type NoteDraft = z.infer<typeof noteDraftSchema>;

export type LlmCall = (prompt: string) => Promise<string>;

export function defaultWeekLabel(): string {
  return isoYearWeek(new Date().toISOString().slice(0, 10));
}

function sourceLabel(source: string): string {
  return source === "appstore" ? "App Store" : "Play Store";
}

/** "+40%" / "-12%" / "flat" / "n/a" — pure presentation of a WoW delta. */
export function formatWow(delta: number | null): string {
  if (delta === null) return "n/a";
  if (delta === 0) return "flat";
  const pct = Math.round(delta * 100);
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

/** Human label for a theme id, e.g. "Charges, Statements & Reports". */
export function themeLabel(theme: TagTheme): string {
  return THEMES[theme as keyof typeof THEMES]?.label ?? theme;
}

export function buildNotePrompt(
  agg: AggregateResult,
  template: string,
  weekLabel: string,
  feedback = "",
): string {
  const topThemes = agg.tagged.slice(0, 3).map((t) => {
    const wow = agg.wow.find((w) => w.theme === t.theme)?.delta ?? null;
    return `    - ${t.theme} (${themeLabel(t.theme as TagTheme)}): ${t.count} reviews, avg ${t.avgRating.toFixed(1)}★, WoW ${formatWow(wow)}`;
  });
  const quoteLines = Object.entries(agg.quotes)
    .flatMap(([theme, pool]) =>
      pool.map((q) => `    - ID ${q.id} [${q.rating}★ ${sourceLabel(q.source)}] "${q.text}" (${theme})`),
    )
    .join("\n");

  let text = template
    .replace("{windowWeeks}", String(agg.windowWeeks))
    .replace("{totalReviews}", String(agg.totalReviews))
    .replace("{averageRating}", agg.averageRating.toFixed(2))
    .replace("{topThemes}", topThemes.join("\n"))
    .replace("{quotes}", quoteLines)
    .replace("{weekLabel}", weekLabel);
  if (feedback) {
    const issue = feedback.includes("\n") ? feedback.split("\n")[0]! : feedback;
    text += `\n\nFEEDBACK FROM PREVIOUS ATTEMPT — fix ALL of these and retry:\n${issue}`;
  }
  return text;
}

export function resolveQuotes(
  quoteIds: string[],
  pool: Map<string, CandidateQuote>,
): CandidateQuote[] {
  const missing = quoteIds.filter((id) => !pool.has(id));
  if (missing.length > 0) throw new Error(`Quote ids not in the candidate pool: ${missing.join(", ")}`);
  const seen = new Set<string>();
  for (const id of quoteIds) {
    if (seen.has(id)) throw new Error(`Duplicate quote id: ${id}`);
    seen.add(id);
  }
  return quoteIds.map((id) => pool.get(id)!);
}

export interface ComposeInput {
  weekLabel: string;
  themes: ThemeSummary[];
  quoteIds: string[];
  actions: NoteAction[];
}

/**
 * Render the note to markdown. wordCount is counted over the actual displayed
 * body (title and section headers excluded) so "<=250 words" is a real,
 * code-verified property of what a reader sees.
 */
export function composeMarkdown(
  input: ComposeInput,
  selected: CandidateQuote[],
  agg: AggregateResult,
): { markdown: string; wordCount: number } {
  const lines: string[] = [];
  lines.push(`# Groww Weekly Review Pulse — ${input.weekLabel}`);
  lines.push(
    `${input.themes.length} themes · ${input.quoteIds.length} voices · ${input.actions.length} actions`,
    `Window: ${agg.windowWeeks} weeks | ${agg.totalReviews} reviews | avg ${agg.averageRating.toFixed(2)}★`,
  );
  input.themes.forEach((t, i) => {
    const stat = agg.tagged.find((x) => x.theme === t.theme);
    const wow = agg.wow.find((w) => w.theme === t.theme)?.delta ?? null;
    lines.push(
      "",
      `## ${i + 1}. ${themeLabel(t.theme)} — ${stat?.count ?? 0} reviews, avg ${(stat?.avgRating ?? 0).toFixed(1)}★${wow === null ? "" : `, WoW ${formatWow(wow)}`}`,
      t.summary,
    );
  });
  lines.push("", "## Voices");
  selected.forEach((q) => lines.push(`> ${q.text} — ${q.rating}★ ${sourceLabel(q.source)}`));
  lines.push("", "## Actions");
  input.actions.forEach((a, i) =>
    lines.push(`${i + 1}. **${a.owner}** — ${a.action} · watch: ${a.metric}`),
  );

  const body = lines
    .filter((l) => l.trim().length > 0 && !/^#/.test(l))
    .map((l) => l.replace(/^[>\-*0-9.]+ */, "").replace(/\*\*/g, "").replace(/^\./, ""))
    .join(" ");
  return { markdown: lines.join("\n") + "\n", wordCount: wordCount(body) };
}

export interface ValidationResult {
  errors: string[];
}

/** Rule checks over the parsed draft (schema already guarantees 3/3/3 shape). */
export function validateDraft(
  draft: NoteDraft,
  agg: AggregateResult,
  selected: CandidateQuote[],
  wordCount: number,
): ValidationResult {
  const errors: string[] = [];
  const topThemes = new Set(agg.tagged.slice(0, 3).map((t) => t.theme));
  for (const t of draft.themes) {
    if (t.theme === "other") errors.push("Theme 'other' must never surface in the note.");
    else if (!topThemes.has(t.theme))
      errors.push(`Theme '${t.theme}' is not one of the ranked top themes.`);
    if (containsPii(t.summary)) errors.push("PII detected in a theme summary.");
  }
  for (const q of selected) {
    if (containsPii(q.text)) errors.push("PII detected in a selected quote.");
  }
  for (const a of draft.actions) {
    if (containsPii(a.action) || containsPii(a.metric)) errors.push("PII detected in an action.");
  }
  if (wordCount > MAX_NOTE_WORDS) {
    errors.push(`Note is ${wordCount} words; must be <= ${MAX_NOTE_WORDS}. Shorten summaries and actions.`);
  }
  return { errors };
}

export interface NoteOptions {
  weekLabel?: string;
  promptTemplate?: string;
  maxRetries?: number;
  llm?: LlmCall;
}

export interface GeneratedNote {
  note: Note;
  selectedQuotes: CandidateQuote[];
}

function defaultLlm(): LlmCall {
  return async (prompt) =>
    mistralChat({
      model: MISTRAL_NOTE_MODEL,
      messages: [{ role: "system", content: prompt }],
      json: true,
    });
}

/** Generate + validate the weekly note. Retries once with feedback on failure. */
export async function generateNote(
  agg: AggregateResult,
  opts: NoteOptions = {},
): Promise<GeneratedNote> {
  const template = opts.promptTemplate ?? (await readFile(NOTE_PROMPT_PATH, "utf8"));
  const weekLabel = opts.weekLabel ?? defaultWeekLabel();
  const llm = opts.llm ?? defaultLlm();
  const maxRetries = opts.maxRetries ?? 1;

  const pool = new Map<string, CandidateQuote>();
  for (const candidates of Object.values(agg.quotes)) {
    for (const q of candidates) {
      if (pool.has(q.id)) throw new Error(`Duplicate quote id in pool: ${q.id}`);
      pool.set(q.id, q);
    }
  }

  let feedback = "";
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const raw = await llm(buildNotePrompt(agg, template, weekLabel, feedback));
    let draft: NoteDraft;
    try {
      draft = noteDraftSchema.parse(extractJson(raw));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unparseable reply";
      if (attempt < maxRetries) {
        feedback = `Your reply was not valid JSON matching the required 3/3/3 shape. Error: ${msg}`;
        continue;
      }
      throw new Error(`Note draft failed validation after ${maxRetries + 1} attempts: ${msg}`);
    }

    const selected = resolveQuotes(draft.quoteIds, pool);
    const { wordCount: count } = composeMarkdown(draft, selected, agg);
    const { errors } = validateDraft(draft, agg, selected, count);

    if (errors.length === 0) {
      const note: Note = {
        weekLabel,
        generatedAt: new Date().toISOString(),
        themes: draft.themes,
        quoteIds: draft.quoteIds,
        actions: draft.actions,
        wordCount: count,
      };
      return { note, selectedQuotes: selected };
    }
    if (attempt < maxRetries) {
      feedback = errors.join(" ");
    } else {
      throw new Error(
        `Note failed validation after ${maxRetries + 1} attempts: ${errors.join("; ")}`,
      );
    }
  }
  throw new Error("Unreachable: generateNote retry loop exhausted.");
}