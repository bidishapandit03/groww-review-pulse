import { CORPUS_KEY } from "@/lib/pipeline/types";
import { THEME_IDS, OTHER_BUCKET } from "@/lib/constants";
import { readJson } from "@/lib/state";
import { redactReviews } from "@/lib/redact";
import type { Review } from "@/lib/types";

/**
 * Phase 4: sample a stratified gold set from the corpus and write it to
 * data/sample/gold-set.json (COMMITTED — therefore redacted only; no review
 * ids, no PII). Over-samples low ratings because complaints drive the pulse.
 *
 * Usage: npx tsx scripts/gold-set.ts [count] [seed]
 * Then hand-label each entry's `label` field using the legend (it starts empty);
 * validate with npm test (gold-set tests are a CI gate).
 */

interface GoldEntry {
  goldId: string;
  source: Review["source"];
  rating: number;
  date: string;
  title: string;
  text: string;
  /** Hand label, one of the THEME_IDS or "other". Fill after generation. */
  label: string;
  note?: string;
}

/** Deterministic PRNG so a given seed reproduces the same sample. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stratified per-rating targets (over-samples 1-star). Must sum to count. */
function strataFor(count: number): Record<number, number> {
  const one = Math.round(count * 0.56);
  const two = Math.round(count * 0.04);
  const three = Math.round(count * 0.1);
  const four = Math.round(count * 0.1);
  const five = count - one - two - three - four;
  return { 1: one, 2: two, 3: three, 4: four, 5: five };
}

function pick<T>(pool: T[], n: number, rand: () => number): T[] {
  const arr = [...pool];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, n);
}

async function main() {
  const count = Number.parseInt(process.argv[2] ?? "50", 10);
  const seed = Number.parseInt(process.argv[3] ?? "20260919", 10);
  const rand = mulberry32(seed);

  const corpus = (await readJson<Review[]>(CORPUS_KEY)) ?? [];
  if (corpus.length === 0) throw new Error("Empty corpus — run the import step first.");

  const byRating = (r: number) => corpus.filter((x) => x.rating === r);
  const chosen: Review[] = [];
  for (const [rating, n] of Object.entries(strataFor(count))) {
    chosen.push(...pick(byRating(Number(rating)), n, rand));
  }
  // preserve the (seeded) shuffle order for a readable mix
  chosen.sort(() => rand() - 0.5);

  const redacted = redactReviews(chosen);
  if (redacted.length !== chosen.length) {
    throw new Error("Some sampled reviews redacted to empty — increase the sample pool.");
  }

  const entries: GoldEntry[] = redacted.map((r, i) => ({
    goldId: `gs_${String(i + 1).padStart(3, "0")}`,
    source: r.source,
    rating: r.rating,
    date: r.date,
    title: r.title,
    text: r.text,
    label: "",
  }));

  const { writeFile, mkdir } = await import("node:fs/promises");
  await mkdir("data/sample", { recursive: true });
  await writeFile(
    "data/sample/gold-set.json",
    `${JSON.stringify(entries, null, 2)}\n`,
    "utf8",
  );

  const valid = new Set([...THEME_IDS, OTHER_BUCKET]);
  const dist = entries.reduce<Record<number, number>>((a, e) => {
    a[e.rating] = (a[e.rating] ?? 0) + 1;
    return a;
  }, {});
  console.log(`gold set: ${entries.length} entries written to data/sample/gold-set.json`);
  console.log(`ratings: ${JSON.stringify(dist)} | valid labels: ${[...valid].join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});