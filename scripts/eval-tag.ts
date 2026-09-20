import { config } from "dotenv";
config({ path: ".env.local" });
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { THEME_IDS } from "@/lib/constants";
import { containsPii } from "@/lib/redact";
import { tagReviews } from "@/lib/pipeline/tag";
import type { Review, TaggedReview } from "@/lib/types";

/**
 * Phase 5 accuracy check: tag the 50-review gold set with Mistral and compare
 * against the hand labels. Manual run — needs MISTRAL_API_KEY + network.
 *
 * Usage: npx tsx scripts/eval-tag.ts [minAccuracy]   (default min 0.7)
 */

interface GoldEntry {
  goldId: string;
  source: Review["source"];
  rating: number;
  date: string;
  title: string;
  text: string;
  label: string;
}

function toReview(entry: GoldEntry): Review {
  return {
    id: entry.goldId,
    source: entry.source,
    rating: entry.rating,
    title: entry.title,
    text: entry.text,
    date: entry.date,
  };
}

async function main() {
  const minAccuracy = Number.parseFloat(process.argv[2] ?? "0.7");
  const goldPath = path.join(process.cwd(), "data/sample/gold-set.json");
  const gold = JSON.parse(await readFile(goldPath, "utf8")) as GoldEntry[];

  const tagged: TaggedReview[] = await tagReviews(gold.map(toReview));

  let correct = 0;
  const confused: Record<string, Set<string>> = {};
  const byTheme: Record<string, { total: number; ok: number }> = {};
  const leaks: string[] = [];

  for (let i = 0; i < gold.length; i += 1) {
    const expected = gold[i]!.label;
    const got = tagged[i]!.theme;
    if (containsPii(`${tagged[i]!.title} ${tagged[i]!.text}`)) leaks.push(gold[i]!.goldId);
    byTheme[expected] = byTheme[expected] ?? { total: 0, ok: 0 };
    byTheme[expected]!.total += 1;
    if (expected === got) {
      correct += 1;
      byTheme[expected]!.ok += 1;
    } else {
      const key = `${expected}->${got}`;
      confused[key] = confused[key] ?? new Set();
      confused[key]!.add(gold[i]!.goldId);
    }
  }

  const accuracy = correct / gold.length;
  console.log(`Gold set: ${gold.length} reviews`);
  console.log(`Accuracy: ${(accuracy * 100).toFixed(1)}% (${correct}/${gold.length})`);
  console.log("\nPer theme:");
  for (const theme of [...THEME_IDS, "other"]) {
    const s = byTheme[theme];
    if (!s) continue;
    console.log(`  ${theme.padEnd(22)} ${String(s.ok).padStart(2)}/${String(s.total).padStart(2)} (${((s.ok / s.total) * 100).toFixed(0)}%)`);
  }
  if (Object.keys(confused).length > 0) {
    console.log("\nConfusions (expected->got):");
    for (const [key, ids] of Object.entries(confused)) {
      console.log(`  ${key}: ${[...ids].join(", ")}`);
    }
  }
  if (leaks.length > 0) console.error(`\nPII LEAKS in tagged output: ${leaks.join(", ")}`);

  await writeFile(
    path.join(process.cwd(), "data/sample/tagged-gold.json"),
    `${JSON.stringify({ accuracy, tagged }, null, 2)}\n`,
    "utf8",
  );
  console.log("\nTagged output written to data/sample/tagged-gold.json (redacted)");

  if (leaks.length > 0) process.exit(1);
  if (accuracy < minAccuracy) {
    console.error(`Accuracy ${accuracy.toFixed(2)} below minimum ${minAccuracy}.`);
    process.exit(1);
  }
  console.log(`PASS: accuracy meets ${minAccuracy} minimum.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});