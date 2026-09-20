import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";
import { aggregate } from "@/lib/pipeline/aggregate";
import { composeMarkdown, generateNote } from "@/lib/pipeline/note";
import { taggedReviewSchema } from "@/lib/types";

config({ path: ".env.local" });

/**
 * Phase 7 demo: generate a real weekly note from the tagged gold set via
 * Mistral and print the rendered markdown. Also writes the sample note to
 * outputs/ (committed, PII-gated). Uses the aggregate from the tagged gold
 * set (not the full window corpus, which is wired in Phase 9).
 */
async function main() {
  const file = path.join(process.cwd(), "data/sample/tagged-gold.json");
  const raw = JSON.parse(await readFile(file, "utf8")) as { tagged: unknown };
  const tagged = taggedReviewSchema.array().parse(raw.tagged);

  const agg = aggregate(tagged, { windowWeeks: 8 });
  const { note, selectedQuotes } = await generateNote(agg);

  const { markdown, wordCount } = composeMarkdown(note, selectedQuotes, agg);

  const out = path.join(process.cwd(), "outputs", "weekly-note-sample.md");
  await writeFile(out, markdown, "utf8");
  const outJson = path.join(process.cwd(), "outputs", "weekly-note-sample.json");
  await writeFile(outJson, JSON.stringify({ note, selectedQuotes }, null, 2), "utf8");
  console.log(markdown);
  console.log(`[wordCount=${wordCount} validators_passed wrote=${out}]`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});