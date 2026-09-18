import { fetchFreshReviews, mergeCorpus, sliceWindow } from "@/lib/imports";
import { CORPUS_KEY } from "@/lib/pipeline/types";
import { readJson, writeJson } from "@/lib/state";
import type { Review } from "@/lib/types";

/** Manual diagnostic: pull both stores, merge into the private corpus, slice the
 *  window. Writes raw reviews to the private state store (gitignored locally). */
async function main() {
  const fresh = await fetchFreshReviews();
  const existing = (await readJson<Review[]>(CORPUS_KEY)) ?? [];
  const corpus = mergeCorpus(existing, fresh);
  await writeJson(CORPUS_KEY, corpus);

  const { reviews, coverage } = sliceWindow(corpus, 8);
  console.log("fetched:", fresh.length, "| corpus:", corpus.length, "| in window:", reviews.length);
  console.log("coverage:", JSON.stringify(coverage));
  console.log(
    "by source:",
    reviews.reduce<Record<string, number>>((a, r) => {
      a[r.source] = (a[r.source] ?? 0) + 1;
      return a;
    }, {}),
  );
  console.log(
    "oldest 3:",
    reviews.slice(-3).map((r) => `${r.date} ${r.source} [${r.rating}] ${r.title.slice(0, 40)}`),
  );
  console.log(
    "newest 3:",
    reviews.slice(0, 3).map((r) => `${r.date} ${r.source} [${r.rating}] ${r.title.slice(0, 40)}`),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
