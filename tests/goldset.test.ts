import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OTHER_BUCKET, THEME_IDS } from "@/lib/constants";
import { containsPii } from "@/lib/redact";

interface GoldEntry {
  goldId: string;
  source: "appstore" | "playstore";
  rating: number;
  date: string;
  title: string;
  text: string;
  label: string;
}

const goldSet = JSON.parse(
  readFileSync(path.join(process.cwd(), "data/sample/gold-set.json"), "utf8"),
) as GoldEntry[];

describe("gold set (data/sample/gold-set.json)", () => {
  it("has ~50 hand-labeled entries", () => {
    expect(goldSet.length).toBeGreaterThanOrEqual(45);
    expect(goldSet.length).toBeLessThanOrEqual(60);
  });

  it("uses unique goldIds", () => {
    const ids = goldSet.map((e) => e.goldId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("labels every entry with a valid theme", () => {
    const valid = new Set<unknown>([...THEME_IDS, OTHER_BUCKET]);
    for (const e of goldSet) {
      expect(valid.has(e.label), `${e.goldId} label=${e.label}`).toBe(true);
    }
  });

  it("covers both stores and spreads across ratings", () => {
    const sources = new Set(goldSet.map((e) => e.source));
    const ratings = new Set(goldSet.map((e) => e.rating));
    expect(sources).toContain("appstore");
    expect(sources).toContain("playstore");
    for (const r of [1, 2, 3, 4, 5]) expect(ratings).toContain(r);
  });

  it("contains zero PII (redacted before commit)", () => {
    for (const e of goldSet) {
      const joined = `${e.title} ${e.text}`;
      expect(containsPii(joined), `${e.goldId} leaked PII`).toBe(false);
    }
  });

  it("has at least one entry per category theme in the legend", () => {
    const used = new Set(goldSet.map((e) => e.label));
    for (const t of THEME_IDS) {
      expect(used.has(t), `theme ${t} absent from gold set`).toBe(true);
    }
  });
});