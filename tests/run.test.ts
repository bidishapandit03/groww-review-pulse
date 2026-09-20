import { describe, expect, it } from "vitest";
import { adminGate } from "@/lib/pipeline/gate";
import { ConflictError, diffNewReviews, runPulse, runSingleStep } from "@/lib/pipeline/run";
import type { StateStore, StepResult } from "@/lib/pipeline/run";
import { AGGREGATE_KEY, CORPUS_KEY, NOTE_KEY, STATE_KEY, TAGGED_KEY } from "@/lib/pipeline/types";
import type { AggregateResult, PipelineState } from "@/lib/pipeline/types";
import type { Note, TaggedReview } from "@/lib/types";

function memStore(initial: Record<string, unknown> = {}): StateStore {
  const map = new Map(Object.entries(initial));
  return {
    read: async <T>(key: string) => (map.has(key) ? (map.get(key) as T) : null),
    write: async (key, value) => {
      map.set(key, value);
    },
  };
}

const review = (id: string, date = "2026-09-10") => ({
  id,
  source: "playstore" as const,
  rating: 1,
  title: "",
  text: `text ${id}`,
  date,
});

const tagged = (id: string): TaggedReview => ({ ...review(id), theme: "other" });

const doneStep =
  (step: string, numbers: StepResult["numbers"] = {}) =>
  async (): Promise<StepResult> => ({
    step: step as StepResult["step"],
    summary: `${step} ok`,
    numbers,
  });

describe("diffNewReviews", () => {
  it("returns only unseen ids", () => {
    const all = [review("a"), review("b"), review("c")];
    const prior = [tagged("a")];
    expect(diffNewReviews(all, prior).map((r) => r.id)).toEqual(["b", "c"]);
  });

  it("handles empty sides", () => {
    expect(diffNewReviews([], [tagged("a")])).toEqual([]);
    expect(diffNewReviews([review("a")], [])).toHaveLength(1);
  });
});

describe("adminGate", () => {
  it("is open when no ADMIN_PASSWORD is set", async () => {
    const original = process.env.ADMIN_PASSWORD;
    delete process.env.ADMIN_PASSWORD;
    expect(await adminGate(new Request("http://x/p", { headers: {} }))).toBe(true);
    if (original !== undefined) process.env.ADMIN_PASSWORD = original;
  });

  it("rejects wrong and accepts right password", async () => {
    const original = process.env.ADMIN_PASSWORD;
    process.env.ADMIN_PASSWORD = "secret";
    const req = (pw?: string) =>
      new Request("http://x/p", { headers: pw ? { "x-admin-password": pw } : {} });
    expect(await adminGate(req())).toBe(false);
    expect(await adminGate(req("nope"))).toBe(false);
    expect(await adminGate(req("secret"))).toBe(true);
    if (original !== undefined) process.env.ADMIN_PASSWORD = original;
    else delete process.env.ADMIN_PASSWORD;
  });
});

describe("runPulse", () => {
  const fakeSteps = () => ({
    import: doneStep("import", { reviewsImported: 3, corpusSize: 3 }),
    redact: doneStep("redact", { reviewsAfterRedaction: 3 }),
    tag: doneStep("tag", { newlyTagged: 0, totalTagged: 3 }),
    aggregate: doneStep("aggregate", { windowReviews: 3 }),
    note: doneStep("note", { wordCount: 120 }),
    email: doneStep("email", { bytes: 512 }),
  });

  it("runs all steps and lands state to idle", async () => {
    const store = memStore();
    const outcome = await runPulse({ store, steps: fakeSteps() });
    expect(outcome.status).toBe("done");
    expect(outcome.steps).toEqual(["import", "redact", "tag", "aggregate", "note", "email"]);

    const state = (await store.read<PipelineState>(STATE_KEY))!;
    expect(state.step).toBe("idle");
    expect(state.lastError).toBeNull();
    expect(state.meta.reviewsImported).toBe(3);
    expect(state.meta.reviewsAfterRedaction).toBe(3);
    expect(outcome.runId).toBeTruthy();
  });

  it("rejects a concurrent run", async () => {
    const state: PipelineState = {
      runId: "old",
      createdAt: "2026-09-20T00:00:00.000Z",
      updatedAt: "2026-09-20T00:00:00.000Z",
      windowWeeks: 8,
      step: "tag",
      meta: {
        runId: "old",
        startedAt: "2026-09-20T00:00:00.000Z",
        windowWeeks: 8,
        stores: ["appstore", "playstore"],
        reviewsImported: 0,
        reviewsAfterRedaction: 0,
        coverage: { appstore: null, playstore: null },
      },
      lastError: null,
    };
    const store = memStore({ [STATE_KEY]: state });
    await expect(runPulse({ store })).rejects.toThrow(ConflictError);
  });

  it("records lastError and rethrows when a step fails", async () => {
    const store = memStore();
    const steps = {
      ...fakeSteps(),
      note: async () => {
        throw new Error("model exploded");
      },
    };
    await expect(runPulse({ store, steps })).rejects.toThrow("model exploded");
    const state = (await store.read<PipelineState>(STATE_KEY))!;
    expect(state.step).toBe("aggregate");
    expect(state.lastError).toContain("model exploded");
  });

  it("writes step artifacts through injected steps (happy path with real shape)", async () => {
    const store = memStore({
      [CORPUS_KEY]: [review("r1"), review("r2", "2026-08-01")],
    });
    const steps = {
      import: async () => {
        await store.write(CORPUS_KEY, [review("r1"), review("r2", "2026-08-01")]);
        return doneStep("import")().then((r) => r);
      },
      redact: doneStep("redact"),
      tag: async (_s: StateStore) => {
        await _s.write(TAGGED_KEY, [tagged("r1")]);
        return doneStep("tag")().then((r) => r);
      },
      aggregate: async (_s: StateStore) => {
        const agg: AggregateResult = {
          windowWeeks: 8,
          totalReviews: 1,
          averageRating: 1,
          tagged: [{ theme: "trading_orders", count: 1, avgRating: 1 }],
          quotes: {},
          wow: [{ theme: "trading_orders", delta: null }],
        };
        await _s.write(AGGREGATE_KEY, agg);
        return doneStep("aggregate")().then((r) => r);
      },
      note: async (_s: StateStore) => {
        const note: Note = {
          weekLabel: "2026-W38",
          generatedAt: "2026-09-20T00:00:00.000Z",
          themes: [
            { theme: "trading_orders", summary: "ok" },
            { theme: "charges_statements", summary: "ok" },
            { theme: "app_support", summary: "ok" },
          ],
          quoteIds: [],
          actions: [
            { action: "a", owner: "Product", metric: "m" },
            { action: "a", owner: "Support", metric: "m" },
            { action: "a", owner: "Growth", metric: "m" },
          ],
          wordCount: 40,
        };
        await _s.write(NOTE_KEY, note);
        return doneStep("note")().then((r) => r);
      },
      email: doneStep("email"),
    };
    const outcome = await runPulse({ store, steps });
    expect(outcome.status).toBe("done");
    expect(await store.read(TAGGED_KEY)).toBeDefined();
    expect(await store.read(AGGREGATE_KEY)).toBeDefined();
    expect(await store.read(NOTE_KEY)).toBeDefined();
  });
});

describe("runSingleStep", () => {
  it("runs a single step and resets state to idle", async () => {
    const store = memStore();
    const result = await runSingleStep("redact", { store, steps: { redact: doneStep("redact") } });
    expect(result.step).toBe("redact");
    const state = (await store.read<PipelineState>(STATE_KEY))!;
    expect(state.step).toBe("idle");
  });
});