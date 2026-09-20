import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";
import { buildEml } from "@/lib/pipeline/email";
import { composeMarkdown } from "@/lib/pipeline/note";
import { runPulse } from "@/lib/pipeline/run";
import { AGGREGATE_KEY, NOTE_KEY } from "@/lib/pipeline/types";
import { readJson } from "@/lib/state";
import type { AggregateResult, CandidateQuote } from "@/lib/pipeline/types";
import type { Note } from "@/lib/types";

config({ path: ".env.local" });

/**
 * Local one-shot pipeline (same code the cron/button runs): import → redact →
 * tag → aggregate → note → email, against the default store (local data/raw/,
 * or Vercel Blob if a real token is present). Also writes the note + .eml to
 * outputs/ for convenience.
 */
async function main() {
  console.log("Running weekly pipeline…");
  const outcome = await runPulse();
  console.log(`  run ${outcome.runId}: ${outcome.steps.join(" → ")}`);

  const note = await readJson<Note>(NOTE_KEY);
  const agg = await readJson<AggregateResult>(AGGREGATE_KEY);
  if (!note || !agg) throw new Error("pipeline finished but note/aggregate missing");

  const pool = new Map<string, CandidateQuote>();
  for (const candidates of Object.values(agg.quotes)) {
    for (const q of candidates) if (!pool.has(q.id)) pool.set(q.id, q);
  }
  const selected = note.quoteIds.map((id) => pool.get(id)).filter(Boolean) as CandidateQuote[];
  const { markdown } = composeMarkdown(note, selected, agg);

  const mdPath = path.join(process.cwd(), "outputs", `weekly-note-${note.weekLabel}.md`);
  await writeFile(mdPath, markdown, "utf8");
  // Emails carry the real recipient (PII) — never into committed outputs/.
  const emlDir = path.join(process.cwd(), "data", "raw", "emails");
  await mkdir(emlDir, { recursive: true });
  const emlPath = path.join(emlDir, `weekly-email-${note.weekLabel}.eml`);
  await writeFile(emlPath, buildEml(note, markdown), "utf8");
  console.log(`  wrote ${mdPath}`);
  console.log(`  wrote ${emlPath}`);
  console.log(`  note: ${note.wordCount} words, week ${note.weekLabel}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});