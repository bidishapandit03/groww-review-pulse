import { readFile } from "node:fs/promises";
import path from "node:path";
import { aggregate } from "@/lib/pipeline/aggregate";
import { defaultStore, readState } from "@/lib/pipeline/run";
import type { AggregateResult, CandidateQuote, PipelineState } from "@/lib/pipeline/types";
import { AGGREGATE_KEY, NOTE_KEY } from "@/lib/pipeline/types";
import { readJson } from "@/lib/state";
import type { Note } from "@/lib/types";
import { noteSchema, taggedReviewSchema } from "@/lib/types";

/**
 * Load the latest pulse for the public page: the validated note + the aggregate
 * that produced it. Reads from the state store (Blob in prod, data/raw locally).
 * When no pipeline run has happened yet (fresh dev checkout), falls back to the
 * committed demo artifacts so `npm run dev` renders real content immediately.
 */

export interface PulseData {
  note: Note;
  aggregate: AggregateResult;
  selectedQuotes: CandidateQuote[];
  /** last run metadata from STATE_KEY (null before any run) */
  lastRun: PipelineState | null;
  demo: boolean;
}

async function fromStore(): Promise<PulseData | null> {
  const [note, agg, lastRun] = await Promise.all([
    readJson<Note>(NOTE_KEY),
    readJson<AggregateResult>(AGGREGATE_KEY),
    readState(defaultStore),
  ]);
  if (!note || !agg) return null;
  const pool = new Map<string, CandidateQuote>();
  for (const candidates of Object.values(agg.quotes)) {
    for (const q of candidates) {
      if (!pool.has(q.id)) pool.set(q.id, q);
    }
  }
  const selectedQuotes = note.quoteIds
    .map((id) => pool.get(id))
    .filter((q): q is CandidateQuote => Boolean(q));
  if (selectedQuotes.length !== note.quoteIds.length) return null;
  return { note, aggregate: agg, selectedQuotes, lastRun, demo: false };
}

export async function loadPulse(): Promise<PulseData | null> {
  const live = await fromStore();
  if (live) return live;

  // Demo fallback: committed sample note + aggregate recomputed from the
  // tagged gold set. Zero network, zero PII — safe for any checkout.
  try {
    const samplePath = path.join(process.cwd(), "outputs", "weekly-note-sample.json");
    const sample = JSON.parse(await readFile(samplePath, "utf8")) as {
      note: unknown;
      selectedQuotes: CandidateQuote[];
    };
    const note = noteSchema.parse(sample.note);
    const selectedQuotes = sample.selectedQuotes ?? [];

    const goldPath = path.join(process.cwd(), "data/sample/tagged-gold.json");
    const gold = JSON.parse(await readFile(goldPath, "utf8")) as { tagged: unknown };
    const tagged = taggedReviewSchema.array().parse(gold.tagged);
    const agg = aggregate(tagged, { windowWeeks: 8 });

    return { note, aggregate: agg, selectedQuotes, lastRun: null, demo: true };
  } catch {
    return null;
  }
}