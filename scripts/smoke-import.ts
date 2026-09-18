import { importReviews } from "@/lib/imports";

async function main() {
  const { reviews, coverage } = await importReviews(8);
  console.log("imported:", reviews.length);
  console.log("coverage:", JSON.stringify(coverage));
  console.log(
    "by source:",
    reviews.reduce((a, r) => ((a[r.source] = (a[r.source] ?? 0) + 1), a), {} as Record<string, number>),
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