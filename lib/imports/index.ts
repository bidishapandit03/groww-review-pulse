import { WINDOW_MIN_WEEKS, WINDOW_MAX_WEEKS } from "@/lib/constants";
import type { Review } from "@/lib/types";
import { weeksAgoIso } from "@/lib/dates";
import { importAppStoreAll } from "@/lib/imports/appstore";
import { importPlayStoreAll } from "@/lib/imports/playstore";

/** Fetch every review the public stores currently expose (in memory, raw).
 *  Callers must redact before any store or LLM call. */
export async function fetchFreshReviews(): Promise<Review[]> {
  const [app, play] = await Promise.allSettled([
    importAppStoreAll(),
    importPlayStoreAll(),
  ]);
  if (app.status === "rejected" && play.status === "rejected") {
    throw new Error(`Both stores failed to import: ${app.reason}`);
  }
  return [
    ...(app.status === "fulfilled" ? app.value : []),
    ...(play.status === "fulfilled" ? play.value : []),
  ];
}

/** Merge fresh reviews into the persistent corpus; fresh data wins, dedup by id. */
export function mergeCorpus(existing: Review[], fresh: Review[]): Review[] {
  const merged = new Map<string, Review>();
  for (const r of fresh) merged.set(r.id, r);
  for (const r of existing) if (!merged.has(r.id)) merged.set(r.id, r);
  return [...merged.values()];
}

export interface WindowResult<T extends Review = Review> {
  reviews: T[];
  coverage: Record<string, string | null>;
}

/** Slice the corpus to the last N weeks and report per-store oldest date. */
export function sliceWindow<T extends Review = Review>(
  corpus: T[],
  windowWeeks = WINDOW_MIN_WEEKS,
): WindowResult<T> {
  const weeks = Math.min(Math.max(windowWeeks, WINDOW_MIN_WEEKS), WINDOW_MAX_WEEKS);
  const cutoff = weeksAgoIso(weeks);
  const inWindow = corpus
    .filter((r) => r.date >= cutoff)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const byStore = (source: Review["source"]) =>
    corpus
      .filter((r) => r.source === source && r.date >= cutoff)
      .map((r) => r.date)
      .sort();
  const first = (arr: string[]): string | null => (arr.length > 0 ? arr[0]! : null);
  return {
    reviews: inWindow,
    coverage: {
      appstore: first(byStore("appstore")),
      playstore: first(byStore("playstore")),
    },
  };
}