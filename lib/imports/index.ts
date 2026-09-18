import { WINDOW_MIN_WEEKS, WINDOW_MAX_WEEKS } from "@/lib/constants";
import type { ImportResult, Review } from "@/lib/types";
import { weeksAgoIso } from "@/lib/dates";
import { readJson, writeJson } from "@/lib/state";
import { importAppStoreAll } from "@/lib/imports/appstore";
import { importPlayStoreAll } from "@/lib/imports/playstore";

const CORPUS_KEY = "pipeline/corpus.json";

/**
 * Fetch the newest available reviews from both stores, MERGE them into a
 * persistent corpus (dedup by review id), then return the window slice.
 *
 * The public stores only expose ~2-3 weeks of newest reviews, so an 8-week
 * window takes several weekly runs to fill. Coverage is reported back so the
 * UI can show exactly how deep history actually reaches.
 */
export async function importReviews(
  windowWeeks = WINDOW_MIN_WEEKS,
): Promise<ImportResult> {
  const weeks = Math.min(Math.max(windowWeeks, WINDOW_MIN_WEEKS), WINDOW_MAX_WEEKS);
  const cutoff = weeksAgoIso(weeks);

  const [app, play] = await Promise.allSettled([
    importAppStoreAll(),
    importPlayStoreAll(),
  ]);

  if (app.status === "rejected" && play.status === "rejected") {
    throw new Error(`Both stores failed to import: ${app.reason}`);
  }

  const fresh = [
    ...(app.status === "fulfilled" ? app.value : []),
    ...(play.status === "fulfilled" ? play.value : []),
  ];

  const corpus = (await readJson<Review[]>(CORPUS_KEY)) ?? [];
  const merged = new Map<string, Review>();
  // Fresh data wins (stores occasionally edit/append to a review text).
  for (const r of fresh) merged.set(r.id, r);
  for (const r of corpus) if (!merged.has(r.id)) merged.set(r.id, r);

  await writeJson(CORPUS_KEY, [...merged.values()]);

  const inWindow = [...merged.values()]
    .filter((r) => r.date >= cutoff)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const byStore = (source: Review["source"]) =>
    [...merged.values()]
      .filter((r) => r.source === source && r.date >= cutoff)
      .map((r) => r.date)
      .sort();

  return {
    reviews: inWindow,
    coverage: {
      appstore: firstOrNull(byStore("appstore")),
      playstore: firstOrNull(byStore("playstore")),
    },
  };
}

function firstOrNull(arr: string[]): string | null {
  return arr.length > 0 ? arr[0]! : null;
}