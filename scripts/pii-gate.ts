import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { containsPii } from "@/lib/redact";

/**
 * PII gate: scans every tracked data/output file for residual PII.
 * Part of CI — the build fails if a single pattern leaks.
 * Raw reviews live outside these directories and are gitignored.
 */
const SCAN_DIRS = [path.join(process.cwd(), "data/sample"), path.join(process.cwd(), "outputs")];

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...(await walk(full)));
    else files.push(full);
  }
  return files;
}

async function main() {
  let failed = false;
  for (const dir of SCAN_DIRS) {
    let files: string[] = [];
    try {
      files = await walk(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      const text = await readFile(file, "utf8");
      const hits: string[] = [];
      if (containsPii(text)) hits.push("PII pattern detected");
      for (const line of text.split("\n")) {
        const t = line.trim();
        if (/@([a-z0-9.-]+\.[a-z]{2,}|[\w.-]+@(?:ybl|upi|paytm|okaxis))/i.test(t)) hits.push(t.slice(0, 120));
      }
      if (hits.length > 0) {
        failed = true;
        console.error(`[PII-GATE] ${path.relative(process.cwd(), file)}`);
        for (const h of hits.slice(0, 5)) console.error(`   ${h}`);
      }
    }
  }
  if (failed) {
    console.error("PII gate FAILED — potential leak in tracked data/outputs.");
    process.exit(1);
  }
  console.log("PII gate OK — zero hits in tracked data outputs.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});