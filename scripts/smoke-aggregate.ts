import { readFile } from "node:fs/promises";
import path from "node:path";
import { aggregate } from "@/lib/pipeline/aggregate";
import { taggedReviewSchema } from "@/lib/types";

/**
 * Phase 6 demo: run the aggregate + ranking over the model-tagged gold set
 * (data/sample/tagged-gold.json) so the numbers and quotes can be eyeballed.
 * The real pipeline reads a tagged window corpus; this uses curated sample data.
 */
async function main() {
  const file = path.join(process.cwd(), "data/sample/tagged-gold.json");
  const raw = JSON.parse(await readFile(file, "utf8")) as { tagged: unknown };
  const tagged = taggedReviewSchema.array().parse(raw.tagged);

  const res = aggregate(tagged, { windowWeeks: 8 });

  console.log(`Window reviews: ${res.totalReviews} | avg rating: ${res.averageRating.toFixed(2)}`);
  console.log("\nRanked themes (impact formula, top 10 shown where available):");
  for (const t of res.tagged) {
    const w = res.wow.find((x) => x.theme === t.theme);
    console.log(
      `  ${t.theme.padEnd(22)} n=${String(t.count).padStart(3)} avg=${t.avgRating.toFixed(2)} wow=${w?.delta === null ? "n/a" : (w!.delta! * 100).toFixed(0) + "%"}`,
    );
  }
  console.log("\nCandidate quotes for top themes:");
  for (const [theme, pool] of Object.entries(res.quotes)) {
    console.log(`  ${theme}:`);
    for (const q of pool) console.log(`    [${q.rating}★ ${q.date}] ${q.text.slice(0, 100)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});