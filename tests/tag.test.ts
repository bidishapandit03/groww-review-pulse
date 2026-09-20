import { describe, expect, it } from "vitest";
import { OTHER_BUCKET, THEME_IDS } from "@/lib/constants";
import {
  buildTagLines,
  chunkReviews,
  extractJson,
  parseTagResponse,
  tagBatch,
} from "@/lib/pipeline/tag";
import { containsPii } from "@/lib/redact";
import type { Review } from "@/lib/types";

const baseReview = (i: number, text: string): Review => ({
  id: `r${i}`,
  source: "playstore",
  rating: 1,
  title: "",
  text,
  date: "2026-09-10",
});

const TEMPLATE = "THEMES...\n{{reviews}}";

describe("chunkReviews", () => {
  it("splits into batch sizes", () => {
    expect(chunkReviews([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it("handles empty input", () => {
    expect(chunkReviews([], 3)).toEqual([]);
  });
});

describe("buildTagLines", () => {
  it("redacts PII before it reaches the prompt", () => {
    const lines = buildTagLines([
      baseReview(0, "call 9876543210 or email ravi@ybl"),
    ]);
    const prompt = TEMPLATE.replace("{{reviews}}", lines.join("\n"));
    expect(prompt).not.toContain("9876543210");
    expect(prompt).not.toContain("ravi@ybl");
    expect(prompt).toContain("[REDACTED]");
    expect(containsPii(prompt)).toBe(false);
  });
  it("prefixes each line with its index and keeps titles", () => {
    const lines = buildTagLines([
      baseReview(0, "order failed"),
      { ...baseReview(1, "kya"), title: "KYC delay" },
    ]);
    expect(lines[0]).toContain("0.");
    expect(lines[0]).toContain("order failed");
    expect(lines[1]).toContain("1. [KYC delay] kya");
  });
});

describe("extractJson", () => {
  it("parses bare JSON", () => {
    expect(extractJson('{"0":"trading_orders"}')).toEqual({ 0: "trading_orders" });
  });
  it("strips markdown fences", () => {
    expect(extractJson('```json\n{"0":"other"}\n```')).toEqual({ 0: "other" });
  });
  it("handles surrounding prose", () => {
    expect(extractJson('Here you go:\n{"1":"app_support"}\nDone.')).toEqual({ 1: "app_support" });
  });
  it("rejects non-JSON replies", () => {
    expect(() => extractJson("sorry, no json")).toThrow();
  });
});

describe("parseTagResponse", () => {
  it("accepts any valid legend value including other", () => {
    const out = parseTagResponse(`{"0":"trading_orders","1":"${OTHER_BUCKET}"}`);
    expect(out).toEqual({ 0: "trading_orders", 1: OTHER_BUCKET });
  });
  it("rejects an invented theme", () => {
    expect(() => parseTagResponse('{"0":"not_a_theme"}')).toThrow(/failed validation/);
  });
});

describe("tagBatch", () => {
  it("maps a valid reply back onto review order with themes", async () => {
    const reviews = [
      baseReview(0, "order lag"),
      baseReview(1, "hidden charges"),
      baseReview(2, "support slow"),
    ];
    const llm = async (prompt: string) => {
      expect(containsPii(prompt)).toBe(false);
      return '{"0":"trading_orders","1":"charges_statements","2":"app_support"}';
    };
    const tagged = await tagBatch(reviews, TEMPLATE, llm);
    expect(tagged.map((r) => r.theme)).toEqual([
      "trading_orders",
      "charges_statements",
      "app_support",
    ]);
    expect(tagged[0]!.id).toBe("r0");
  });
  it("throws when a line index is missing", async () => {
    const llm = async () => '{"0":"trading_orders"}';
    await expect(
      tagBatch([baseReview(0, "a"), baseReview(1, "b")], TEMPLATE, llm),
    ).rejects.toThrow(/missing line 1/);
  });
  it("throws on an invalid theme in a seemingly well-formed reply", async () => {
    const llm = async () => '{"0":"bogus_theme"}';
    await expect(tagBatch([baseReview(0, "a")], TEMPLATE, llm)).rejects.toThrow();
  });
});

describe("legend sanity", () => {
  it("has exactly 5 themes plus the hidden other", () => {
    expect(THEME_IDS.length).toBe(5);
    expect(new Set([...THEME_IDS]).size).toBe(5);
  });
});