import { describe, expect, it } from "vitest";
import type { AggregateResult, CandidateQuote } from "@/lib/pipeline/types";
import {
  buildNotePrompt,
  composeMarkdown,
  formatWow,
  generateNote,
  resolveQuotes,
  themeLabel,
} from "@/lib/pipeline/note";
import type { NoteAction, ThemeSummary } from "@/lib/types";

const quote = (id: string, overrides: Partial<CandidateQuote> = {}): CandidateQuote => ({
  id,
  theme: "charges_statements",
  rating: 1,
  text: "Ghatiya experience hidden charges bahoot hain loot gya mein",
  source: "playstore",
  date: "2026-09-05",
  ...overrides,
});

const agg: AggregateResult = {
  windowWeeks: 8,
  totalReviews: 50,
  averageRating: 2.34,
  tagged: [
    { theme: "trading_orders", count: 7, avgRating: 1 },
    { theme: "charges_statements", count: 6, avgRating: 1.5 },
    { theme: "app_support", count: 5, avgRating: 1.2 },
  ],
  quotes: {
    trading_orders: [quote("t1", { theme: "trading_orders", text: "service not good, charges high." })],
    charges_statements: [quote("c1")],
    app_support: [quote("a1", { theme: "app_support", text: "support is worst." })],
  },
  wow: [
    { theme: "trading_orders", delta: 0.5 },
    { theme: "charges_statements", delta: -0.67 },
    { theme: "app_support", delta: null },
  ],
};

const themes: ThemeSummary[] = [
  { theme: "trading_orders", summary: "Order failures spike during market hours." },
  { theme: "charges_statements", summary: "Hidden charges dominate complaints." },
  { theme: "app_support", summary: "Support response remains slow." },
];

const actions: NoteAction[] = [
  { action: "Fix order status sync", owner: "Product", metric: "order failure rate" },
  { action: "Add charge disclosure", owner: "Product", metric: "charge queries" },
  { action: "Staff support queues", owner: "Support", metric: "first response time" },
];

describe("formatWow", () => {
  it("renders deltas and edge cases", () => {
    expect(formatWow(0.5)).toBe("+50%");
    expect(formatWow(-0.67)).toBe("-67%");
    expect(formatWow(0)).toBe("flat");
    expect(formatWow(null)).toBe("n/a");
  });
});

describe("themeLabel", () => {
  it("maps ids to display labels", () => {
    expect(themeLabel("charging_statements" as never)).toBe("charging_statements");
    expect(themeLabel("charges_statements" as never)).toBe("Charges, Statements & Reports");
  });
});

describe("resolveQuotes", () => {
  it("resolves ids in order", () => {
    const pool = new Map(agg.quotes.charges_statements.map((q) => [q.id, q]));
    const out = resolveQuotes(["c1"], pool);
    expect(out.map((q) => q.id)).toEqual(["c1"]);
  });

  it("throws on missing ids", () => {
    const pool = new Map<string, CandidateQuote>();
    expect(() => resolveQuotes(["nope"], pool)).toThrow(/not in the candidate pool/);
  });

  it("throws on duplicate ids", () => {
    const pool = new Map(agg.quotes.charges_statements.map((q) => [q.id, q]));
    expect(() => resolveQuotes(["c1", "c1"], pool)).toThrow(/Duplicate quote id/);
  });
});

describe("composeMarkdown", () => {
  it("renders a full note with headers, stats, quotes and actions", () => {
    const input = { weekLabel: "2026-W38", themes, quoteIds: ["t1", "c1", "a1"], actions };
    const { markdown } = composeMarkdown(input, [quote("t1"), quote("c1"), quote("a1")], agg);
    expect(markdown).toContain("# Groww Weekly Review Pulse — 2026-W38");
    expect(markdown).toContain("7 reviews, avg 1.0★, WoW +50%");
    expect(markdown).toContain("3 themes · 3 voices · 3 actions");
    expect(markdown).toContain('> Ghatiya experience hidden charges bahoot hain loot gya mein — 1★ Play Store');
    expect(markdown).toContain("1. **Product** — Fix order status sync · watch: order failure rate");
  });

  it("computes wordCount over the body only (title + headers excluded)", () => {
    const input = { weekLabel: "2026-W38", themes, quoteIds: ["t1", "c1", "a1"], actions };
    const { wordCount } = composeMarkdown(input, [quote("t1"), quote("c1"), quote("a1")], agg);
    expect(wordCount).toBeGreaterThan(0);
    expect(wordCount).toBeLessThanOrEqual(250);
  });

  it("counts words, not punctuation/markdown tokens", () => {
    const input = { weekLabel: "2026-W38", themes, quoteIds: ["t1", "c1", "a1"], actions };
    const { wordCount } = composeMarkdown(input, [quote("t1"), quote("c1"), quote("a1")], agg);
    const single = composeMarkdown(
      { weekLabel: "2026-W38", themes, quoteIds: ["c1"], actions },
      [quote("c1")],
      agg,
    );
    expect(wordCount).toBeGreaterThan(single.wordCount);
  });
});

describe("buildNotePrompt", () => {
  it("fills every context slot with real data", () => {
    const prompt = buildNotePrompt(agg, "W:{windowWeeks} T:{totalReviews} A:{averageRating}\n{topThemes}\n{quotes}\nL:{weekLabel}", "2026-W38");
    expect(prompt).toContain("W:8");
    expect(prompt).toContain("T:50");
    expect(prompt).toContain("A:2.34");
    expect(prompt).toContain("L:2026-W38");
    expect(prompt).toContain("trading_orders (Trading & Order Execution)");
    expect(prompt).toContain("ID c1 [1★ Play Store]");
    expect(prompt).toContain("WoW +50%");
  });

  it("appends feedback verbatim on retry", () => {
    const prompt = buildNotePrompt(agg, "{topThemes}", "2026-W38", "Note is too long.");
    expect(prompt).toContain("FEEDBACK FROM PREVIOUS ATTEMPT");
    expect(prompt).toContain("too long");
  });
});

describe("generateNote", () => {
  it("builds a validated Note from a valid JSON reply", async () => {
    const reply = JSON.stringify({
      weekLabel: "2026-W38",
      themes,
      quoteIds: ["t1", "c1", "a1"],
      actions,
    });
    const { note, selectedQuotes } = await generateNote(agg, {
      weekLabel: "2026-W38",
      promptTemplate: "{topThemes}",
      llm: async () => reply,
    });
    expect(note.themes).toHaveLength(3);
    expect(note.quoteIds).toEqual(["t1", "c1", "a1"]);
    expect(note.actions).toHaveLength(3);
    expect(note.wordCount).toBeLessThanOrEqual(250);
    expect(note.generatedAt).toBeTruthy();
    expect(selectedQuotes.map((q) => q.text)).toContain("Ghatiya experience hidden charges bahoot hain loot gya mein");
  });

  it("retries once with feedback when the first reply is invalid, then succeeds", async () => {
    const calls: string[] = [];
    const llm = async (prompt: string) => {
      calls.push(prompt);
      if (calls.length === 1) return "not json at all";
      return JSON.stringify({ weekLabel: "2026-W38", themes, quoteIds: ["t1", "c1", "a1"], actions });
    };
    const { note } = await generateNote(agg, {
      weekLabel: "2026-W38",
      promptTemplate: "{topThemes}",
      llm,
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("FEEDBACK");
    expect(note.quoteIds).toHaveLength(3);
  });

  it("retries once with feedback when the reply fails rule checks (words too long)", async () => {
    const long = "word ".repeat(300).trim();
    const calls: string[] = [];
    const llm = async (prompt: string) => {
      calls.push(prompt);
      if (calls.length === 1) {
        return JSON.stringify({
          weekLabel: "2026-W38",
          themes: themes.map((t) => ({ ...t, summary: long })),
          quoteIds: ["t1", "c1", "a1"],
          actions,
        });
      }
      return JSON.stringify({ weekLabel: "2026-W38", themes, quoteIds: ["t1", "c1", "a1"], actions });
    };
    const { note } = await generateNote(agg, {
      weekLabel: "2026-W38",
      promptTemplate: "{topThemes}",
      llm,
    });
    expect(calls).toHaveLength(2);
    expect(note.wordCount).toBeLessThanOrEqual(250);
  });

  it("throws after retries when the reply keeps failing", async () => {
    const llm = async () => "not json";
    await expect(
      generateNote(agg, { weekLabel: "2026-W38", promptTemplate: "{topThemes}", llm }),
    ).rejects.toThrow(/failed validation after 2 attempts/);
  });

  it("rejects a theme outside the ranked top three", async () => {
    const bad: ThemeSummary[] = [
      { theme: "trading_orders", summary: "ok" },
      { theme: "onboarding_kyc", summary: "not ranked" },
      { theme: "app_support", summary: "ok" },
    ];
    const reply = JSON.stringify({ weekLabel: "2026-W38", themes: bad, quoteIds: ["t1", "c1", "a1"], actions });
    const calls: string[] = [];
    const llm = async (prompt: string) => {
      calls.push(prompt);
      if (calls.length === 1) return reply;
      return JSON.stringify({ weekLabel: "2026-W38", themes, quoteIds: ["t1", "c1", "a1"], actions });
    };
    const { note } = await generateNote(agg, { weekLabel: "2026-W38", promptTemplate: "{topThemes}", llm });
    expect(calls).toHaveLength(2);
    expect(note.themes.map((t) => t.theme)).not.toContain("onboarding_kyc");
  });

  it("rejects a quote id that is not in the pool", async () => {
    const reply = JSON.stringify({ weekLabel: "2026-W38", themes, quoteIds: ["ghost", "c1", "a1"], actions });
    await expect(
      generateNote(agg, { weekLabel: "2026-W38", promptTemplate: "{topThemes}", llm: async () => reply }),
    ).rejects.toThrow(/not in the candidate pool/);
  });
});