import { describe, expect, it } from "vitest";
import {
  aggregate,
  computeThemeStats,
  rankThemes,
  shortlistQuotes,
  wowDelta,
} from "@/lib/pipeline/aggregate";
import { OTHER_BUCKET } from "@/lib/constants";
import { daysAgoIso } from "@/lib/dates";
import type { TagTheme, TaggedReview } from "@/lib/types";

function tr(
  id: string,
  theme: TagTheme,
  rating: number,
  date: string,
  text = "order lag during market hours is annoying",
): TaggedReview {
  return { id, source: "playstore", rating, title: "", text, date, theme };
}

describe("wowDelta", () => {
  it("computes relative change", () => {
    expect(wowDelta(120, 100)).toBeCloseTo(0.2);
    expect(wowDelta(60, 100)).toBeCloseTo(-0.4);
  });
  it("returns null when previous week is empty", () => {
    expect(wowDelta(10, 0)).toBeNull();
  });
});

describe("computeThemeStats", () => {
  it("counts, averages rating and derives negative share", () => {
    const tagged = [
      tr("a", "trading_orders", 1, "2026-09-10"),
      tr("b", "trading_orders", 2, "2026-09-11"),
      tr("c", "trading_orders", 5, "2026-09-12"),
    ];
    const stats = computeThemeStats(tagged);
    const t = stats.find((s) => s.theme === "trading_orders");
    expect(t).toBeDefined();
    expect(t!.count).toBe(3);
    expect(t!.avgRating).toBeCloseTo(8 / 3);
    expect(t!.negativeShare).toBeCloseTo(2 / 3);
  });
  it("skips themes with no reviews", () => {
    const stats = computeThemeStats([tr("a", "trading_orders", 1, "2026-09-10")]);
    expect(stats.map((s) => s.theme)).not.toContain("other");
    expect(stats.length).toBe(1);
  });
  it("momentum: equal-volume theme with WoW growth beats a flat one", () => {
    const prev = daysAgoIso(10);
    const now = daysAgoIso(1);
    const tagged: TaggedReview[] = [];
    // charges_statements: low start, spiking this week (4 -> 12).
    for (let i = 0; i < 4; i += 1) tagged.push(tr(`c${i}`, "charges_statements", 1, prev));
    for (let i = 0; i < 12; i += 1) tagged.push(tr(`c${i}`, "charges_statements", 1, now));
    // app_support: same total volume, no growth (8 -> 8).
    for (let i = 0; i < 8; i += 1) tagged.push(tr(`a${i}`, "app_support", 1, prev));
    for (let i = 0; i < 8; i += 1) tagged.push(tr(`a${i}`, "app_support", 1, now));
    const byImpact = rankThemes(computeThemeStats(tagged)).map((s) => s.theme);
    expect(byImpact[0]).toBe("charges_statements");
    expect(byImpact[1]).toBe("app_support");
  });
});

describe("rankThemes", () => {
  it("excludes the hidden other bucket", () => {
    const stats = computeThemeStats([
      tr("a", "trading_orders", 1, "2026-09-10"),
      tr("b", OTHER_BUCKET, 5, "2026-09-10"),
    ]);
    const ids = rankThemes(stats).map((s) => s.theme);
    expect(ids).toEqual(["trading_orders"]);
  });
  it("orders by impact desc", () => {
    const props = (count: number, negativeShare: number, impact: number) => ({
      theme: "x",
      count,
      avgRating: 2,
      negativeShare,
      wowDelta: null,
      impact,
    });
    const ranked = rankThemes([
      props(10, 0.1, 0.5),
      props(5, 0.9, 0.9),
      props(20, 0.2, 0.6),
    ]);
    expect(ranked.map((s) => s.impact)).toEqual([0.9, 0.6, 0.5]);
  });
});

describe("shortlistQuotes", () => {
  it("filters by word bounds (4-25) and keeps praise + complaints", () => {
    const tagged = [
      tr("s", "trading_orders", 5, "2026-09-10", "charts are beautiful and fast"),
      tr("l", "trading_orders", 1, "2026-09-11", "order failed"),
      tr("ok", "trading_orders", 1, "2026-09-12", "I withdraw money it not come"),
      tr("emoji", "trading_orders", 1, "2026-09-13", "❤️"),
    ];
    const quotes = shortlistQuotes(tagged, "trading_orders");
    const texts = quotes.map((q) => q.text);
    expect(texts).not.toContain("order failed");
    expect(texts).not.toContain("❤️");
    // complaints (low rating) sort first, praise still present
    expect(texts[0]).toBe("I withdraw money it not come");
    expect(texts.some((t) => /charts are beautiful/.test(t!))).toBe(true);
  });
});

describe("aggregate", () => {
  it("returns ranked themes, overall stats and quote pools for top 3", () => {
    const tagged = [
      ...(["trading_orders", "charges_statements", "app_support"] as TagTheme[]).map((t, i) =>
        tr(`n${i}`, t, 1, "2026-09-10"),
      ),
      tr("q", "app_support", 2, "2026-09-11", "The screen freezes and support never replies"),
    ];
    const res = aggregate(tagged, { windowWeeks: 8 });
    expect(res.totalReviews).toBe(4);
    expect(res.tagged.length).toBe(3);
    expect(res.averageRating).toBeCloseTo(1.25);
    expect(Object.keys(res.quotes).length).toBe(3);
    for (const [, pool] of Object.entries(res.quotes)) expect(pool.length).toBeGreaterThan(0);
    expect(res.wow.every((w) => w.theme === "trading_orders" || w.theme === "charges_statements" || w.theme === "app_support")).toBe(true);
  });
});