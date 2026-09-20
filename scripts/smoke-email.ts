import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildEml, mailtoUrl } from "@/lib/pipeline/email";
import { noteSchema } from "@/lib/types";

/**
 * Phase 8 demo: package the sample note (outputs/weekly-note-sample.json + .md,
 * produced by `npm run note:smoke`) into a ready-to-open .eml file. Pure local
 * file ops — no Gmail or OAuth involved.
 */
async function main() {
  const jsonPath = path.join(process.cwd(), "outputs", "weekly-note-sample.json");
  let note;
  try {
    note = noteSchema.parse(JSON.parse(await readFile(jsonPath, "utf8")).note);
  } catch {
    console.error("Run `npm run note:smoke` first to produce outputs/weekly-note-sample.json");
    process.exit(1);
  }
  const markdown = await readFile(
    path.join(process.cwd(), "outputs", "weekly-note-sample.md"),
    "utf8",
  );

  const eml = buildEml(note, markdown);
  const out = path.join(process.cwd(), "outputs", "weekly-email-sample.eml");
  await writeFile(out, eml, "utf8");

  console.log(out);
  console.log(mailtoUrl(note));
  console.log(eml.slice(0, 600));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});