import { PIPELINE_STEPS, WINDOW_MIN_WEEKS } from "@/lib/constants";
import type { PipelineStep } from "@/lib/constants";
import { fetchFreshReviews, mergeCorpus, sliceWindow } from "@/lib/imports";
import { aggregate } from "@/lib/pipeline/aggregate";
import { buildEml } from "@/lib/pipeline/email";
import { composeMarkdown, generateNote } from "@/lib/pipeline/note";
import { tagReviews } from "@/lib/pipeline/tag";
import { AGGREGATE_KEY, CORPUS_KEY, EMAIL_KEY, NOTE_KEY, REDACT_KEY, STATE_KEY, TAGGED_KEY, pipelineRunSchema } from "@/lib/pipeline/types";
import type { AggregateResult, CandidateQuote, PipelineState } from "@/lib/pipeline/types";
import { redactReviews } from "@/lib/redact";
import { readJson, writeJson } from "@/lib/state";
import type { Note, Review, RunMeta, TaggedReview } from "@/lib/types";
import { newId } from "@/lib/types";
import { z } from "zod";

/**
 * Phase 9 orchestrator. Each step is an independent function over the state
 * store; runPulse() runs them in PIPELINE_STEPS order and keeps a PipelineState
 * (runId, step, meta, lastError) at STATE_KEY.
 *
 * Guards:
 *   - one run at a time (concurrent runs rejected with ConflictError)
 *   - raw copies only ever touch CORPUS_KEY in the private store; everything
 *     downstream is redacted and routes/UI emit zero PII
 *   - tagging is incremental: only reviews absent from TAGGED_KEY go to the
 *     LLM, keeping weekly cost/time bounded
 */

export interface StateStore {
  read<T>(key: string): Promise<T | null>;
  write(key: string, data: unknown): Promise<void>;
}

/** Default store: Vercel Blob in prod, data/raw/, locally (lib/state). */
export const defaultStore: StateStore = { read: readJson, write: writeJson };

export type StepFn = (store: StateStore, deps?: RunDeps) => Promise<StepResult>;

export interface StepResult {
  step: PipelineStep;
  summary: string;
  numbers: Record<string, number | string | null>;
}

export interface RunDeps {
  /** tag batch size (defaults to TAG_BATCH_SIZE in tag.ts) */
  batchSize?: number;
  /** forwarded to generateNote (e.g. an injected llm for tests) */
  note?: Parameters<typeof generateNote>[1];
}

/** A newer run is already in flight on this state store. */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

const stateSchema = pipelineRunSchema.extend({ updatedAt: z.string() });

function isoNow(): string {
  return new Date().toISOString();
}

function emptyMeta(runId: string, windowWeeks: number): RunMeta {
  return {
    runId,
    startedAt: isoNow(),
    windowWeeks,
    stores: ["appstore", "playstore"],
    reviewsImported: 0,
    reviewsAfterRedaction: 0,
    coverage: { appstore: null, playstore: null },
  };
}

export async function readState(store: StateStore): Promise<PipelineState | null> {
  const raw = await store.read<unknown>(STATE_KEY);
  if (!raw) return null;
  const parsed = stateSchema.safeParse(raw);
  return parsed.success ? (parsed.data as PipelineState) : null;
}

async function writeState(store: StateStore, state: PipelineState): Promise<void> {
  await store.write(STATE_KEY, state);
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Reviews not yet tagged (by id). Pure. */
export function diffNewReviews<T extends { id: string }>(
  all: T[],
  prior: Array<{ id: string }>,
): T[] {
  const seen = new Set(prior.map((r) => r.id));
  return all.filter((r) => !seen.has(r.id));
}

async function assertIdle(store: StateStore): Promise<void> {
  const state = await readState(store);
  if (state && state.step !== "idle") {
    throw new ConflictError(
      `Pipeline already in progress (run ${state.runId}, step ${state.step}). Wait for it to finish or reset state.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Steps (each an independent function per AGENTS.md)
// ---------------------------------------------------------------------------

export async function importStep(store: StateStore): Promise<StepResult> {
  const fresh = await fetchFreshReviews();
  const existing = (await store.read<Review[]>(CORPUS_KEY)) ?? [];
  const corpus = mergeCorpus(existing, fresh);
  await store.write(CORPUS_KEY, corpus);
  const { coverage } = sliceWindow(corpus, WINDOW_MIN_WEEKS);
  return {
    step: "import",
    summary: `fetched ${fresh.length} fresh reviews; corpus now ${corpus.length}`,
    numbers: { reviewsImported: fresh.length, corpusSize: corpus.length, ...coverage },
  };
}

export async function redactStep(store: StateStore): Promise<StepResult> {
  const corpus = (await store.read<Review[]>(CORPUS_KEY)) ?? [];
  const redacted = redactReviews(corpus);
  await store.write(REDACT_KEY, redacted);
  return {
    step: "redact",
    summary: `cleaned ${redacted.length} reviews; zero PII carried forward`,
    numbers: { reviewsAfterRedaction: redacted.length },
  };
}

export async function tagStep(store: StateStore, deps: RunDeps = {}): Promise<StepResult> {
  const redacted = (await store.read<Review[]>(REDACT_KEY)) ?? [];
  const prior = (await store.read<TaggedReview[]>(TAGGED_KEY)) ?? [];
  const fresh = diffNewReviews(redacted, prior);
  const freshTagged =
    fresh.length > 0 ? await tagReviews(fresh, { batchSize: deps.batchSize }) : [];
  const merged = [...prior, ...freshTagged];
  await store.write(TAGGED_KEY, merged);
  return {
    step: "tag",
    summary: `tagged ${freshTagged.length} new reviews; corpus tagged ${merged.length}`,
    numbers: { newlyTagged: freshTagged.length, totalTagged: merged.length },
  };
}

export async function aggregateStep(store: StateStore): Promise<StepResult> {
  const tagged = (await store.read<TaggedReview[]>(TAGGED_KEY)) ?? [];
  const inWindow = sliceWindow(tagged, WINDOW_MIN_WEEKS).reviews;
  const agg = aggregate(inWindow, { windowWeeks: WINDOW_MIN_WEEKS });
  await store.write(AGGREGATE_KEY, agg);
  return {
    step: "aggregate",
    summary: `ranked ${agg.totalReviews} reviews in the ${WINDOW_MIN_WEEKS}-week window`,
    numbers: { windowReviews: agg.totalReviews },
  };
}

export async function noteStep(store: StateStore, deps: RunDeps = {}): Promise<StepResult> {
  const agg = await store.read<AggregateResult>(AGGREGATE_KEY);
  if (!agg) throw new Error("aggregate must complete before note");
  const { note } = await generateNote(agg, deps.note);
  await store.write(NOTE_KEY, note);
  return {
    step: "note",
    summary: `wrote ${note.weekLabel} note (${note.wordCount} words)`,
    numbers: { wordCount: note.wordCount, weekLabel: note.weekLabel },
  };
}

export async function emailStep(store: StateStore): Promise<StepResult> {
  const note = await store.read<Note>(NOTE_KEY);
  const agg = await store.read<AggregateResult>(AGGREGATE_KEY);
  if (!note || !agg) throw new Error("note + aggregate must complete before email");

  const pool = new Map<string, CandidateQuote>();
  for (const candidates of Object.values(agg.quotes)) {
    for (const q of candidates) if (!pool.has(q.id)) pool.set(q.id, q);
  }
  const selected = note.quoteIds.map((id) => pool.get(id)).filter(Boolean) as CandidateQuote[];
  const { markdown } = composeMarkdown(note, selected, agg);
  const eml = buildEml(note, markdown);
  const filename = `groww-review-pulse-${note.weekLabel}.eml`;
  const bytes = Buffer.byteLength(eml, "utf8");
  await store.write(EMAIL_KEY, { filename, bytes, weekLabel: note.weekLabel, generatedAt: isoNow() });
  return { step: "email", summary: `prepared ${filename} (${bytes} bytes)`, numbers: { bytes } };
}

const defaultSteps: Record<PipelineStep, StepFn> = {
  import: importStep,
  redact: redactStep,
  tag: tagStep,
  aggregate: aggregateStep,
  note: noteStep,
  email: emailStep,
};

function applyNumbers(meta: RunMeta, numbers: StepResult["numbers"]): RunMeta {
  const next: RunMeta = { ...meta };
  if (typeof numbers.reviewsImported === "number") next.reviewsImported = numbers.reviewsImported;
  if (typeof numbers.reviewsAfterRedaction === "number") {
    next.reviewsAfterRedaction = numbers.reviewsAfterRedaction;
  }
  const appstore = numbers.appstore;
  const playstore = numbers.playstore;
  next.coverage = {
    appstore: appstore && typeof appstore === "string" ? appstore : meta.coverage.appstore,
    playstore: playstore && typeof playstore === "string" ? playstore : meta.coverage.playstore,
  };
  return next;
}

export interface RunOptions {
  store?: StateStore;
  deps?: RunDeps;
  /** override individual steps (tests inject fakes; no network then) */
  steps?: Partial<Record<PipelineStep, StepFn>>;
}

export interface RunOutcome {
  runId: string;
  status: "done";
  steps: string[];
}

/**
 * Run the full pipeline (import → redact → tag → aggregate → note → email)
 * against a state store, rejecting concurrent runs. On failure the state keeps
 * step + lastError and the error is re-thrown for the route layer.
 */
export async function runPulse(opts: RunOptions = {}): Promise<RunOutcome> {
  const store = opts.store ?? defaultStore;
  const steps = { ...defaultSteps, ...opts.steps };
  await assertIdle(store);

  const runId = newId();
  const windowWeeks = WINDOW_MIN_WEEKS;
  const state: PipelineState = {
    runId,
    createdAt: isoNow(),
    updatedAt: isoNow(),
    windowWeeks,
    step: PIPELINE_STEPS[0]!,
    meta: emptyMeta(runId, windowWeeks),
    lastError: null,
  };
  await writeState(store, state);

  const done: string[] = [];
  try {
    for (const step of PIPELINE_STEPS) {
      const result = await steps[step]!(store, opts.deps);
      state.step = step;
      state.updatedAt = isoNow();
      state.meta = applyNumbers(state.meta, result.numbers);
      done.push(step);
      await writeState(store, { ...state });
    }
  } catch (err) {
    state.updatedAt = isoNow();
    state.lastError = errMessage(err);
    await writeState(store, { ...state });
    throw err;
  }

  state.step = "idle";
  state.updatedAt = isoNow();
  state.lastError = null;
  await writeState(store, { ...state });
  return { runId, status: "done", steps: done };
}

/** Run exactly one step (manual per-step route), with the same state guards. */
export async function runSingleStep(
  step: PipelineStep,
  opts: RunOptions = {},
): Promise<StepResult> {
  const store = opts.store ?? defaultStore;
  const steps = { ...defaultSteps, ...opts.steps };
  const fn = steps[step];
  if (!fn) throw new Error(`Unknown pipeline step: ${step}`);

  await assertIdle(store);
  const state = await readState(store);
  const runId = state?.runId ?? newId();
  const windowWeeks = WINDOW_MIN_WEEKS;
  const base: PipelineState = state ?? {
    runId,
    createdAt: isoNow(),
    updatedAt: isoNow(),
    windowWeeks,
    step: "idle",
    meta: emptyMeta(runId, windowWeeks),
    lastError: null,
  };

  const active: PipelineState = { ...base, runId, step, lastError: null, updatedAt: isoNow() };
  await writeState(store, active);
  try {
    const result = await fn(store, opts.deps);
    active.step = "idle";
    active.updatedAt = isoNow();
    active.meta = applyNumbers(active.meta, result.numbers);
    await writeState(store, active);
    return result;
  } catch (err) {
    active.step = step;
    active.lastError = errMessage(err);
    active.updatedAt = isoNow();
    await writeState(store, active);
    throw err;
  }
}