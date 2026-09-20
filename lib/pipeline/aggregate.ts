import {
  OTHER_BUCKET,
  QUOTE_CANDIDATES_PER_THEME,
  QUOTE_MAX_WORDS,
  QUOTE_MIN_WORDS,
  THEME_IDS,
} from "@/lib/constants";
import { daysAgoIso } from "@/lib/dates";
import type { AggregateResult, CandidateQuote } from "@/lib/pipeline/types";
import type { TaggedReview } from "@/lib/types";

/**
 * Phase 6: everything exact is computed here in code (PRD FR4) — the LLM never
 * does arithmetic.
 *
 * Ranking formula (product decision, transparent and tunable):
 *   Impact(theme) = 0.5 * volume + 0.3 * negativity + 0.2 * momentum
 *   - volume     = count / max(count over themes)          -> "how many users"
 *   - negativity = share of 1-3 star reviews in the theme   -> "how angry"
 *   - momentum   = clamped positive week-over-week growth   -> "how urgent"
 * The hidden "other" bucket never competes nor surfaces.
 */

const VOLUME_WEIGHT = 0.5;
const SEVERITY_WEIGHT = 0.3;
const MOMENTUM_WEIGHT = 0.2;

export interface ThemeStats {
  theme: string;
  count: number;
  avgRating: number;
  negativeShare: number;
  wowDelta: number | null;
  impact: number;
}

/** Week-over-week relative change; null when there was no prior week. */
export function wowDelta(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  return (current - previous) / previous;
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function average(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Per-theme stats for the window plus a 7d-vs-prior-7d momentum signal. */
export function computeThemeStats(tagged: TaggedReview[]): ThemeStats[] {
  const groups = new Map<string, TaggedReview[]>();
  for (const r of tagged) {
    const list = groups.get(r.theme) ?? [];
    list.push(r);
    groups.set(r.theme, list);
  }

  const sevenAgo = daysAgoIso(7);
  const fourteenAgo = daysAgoIso(14);

  const stats: ThemeStats[] = [];
  for (const theme of [...THEME_IDS, OTHER_BUCKET]) {
    const pool = groups.get(theme) ?? [];
    if (pool.length === 0) continue;
    const current = pool.filter((r) => r.date >= sevenAgo).length;
    const previous = pool.filter((r) => r.date >= fourteenAgo && r.date < sevenAgo).length;
    const delta = wowDelta(current, previous);
    const impact = Math.max(0, delta ?? 0);
    stats.push({
      theme,
      count: pool.length,
      avgRating: average(pool.map((r) => r.rating)),
      negativeShare: pool.filter((r) => r.rating <= 3).length / pool.length,
      wowDelta: delta,
      impact,
    });
  }

  // severity is inherent; volume and momentum get normalized across themes.
  const maxCount = Math.max(...stats.map((s) => s.count), 1);
  const maxMomentum = Math.max(...stats.map((s) => s.impact), 1);
  for (const s of stats) {
    s.impact = VOLUME_WEIGHT * (s.count / maxCount) + SEVERITY_WEIGHT * s.negativeShare +
      MOMENTUM_WEIGHT * (s.impact / maxMomentum);
  }
  return stats;
}

/** Rank NON-other themes by impact, best first. Never includes "other". */
export function rankThemes(stats: ThemeStats[]): ThemeStats[] {
  return stats
    .filter((s) => s.theme !== OTHER_BUCKET)
    .sort((a, b) => b.impact - a.impact || b.count - a.count);
}

function isQuoteWorthy(text: string): boolean {
  const words = wordCount(text);
  if (words < QUOTE_MIN_WORDS || words > QUOTE_MAX_WORDS) return false;
  if (text.length < 8) return false;
  if (!/[a-zA-Z]{2,}/.test(text)) return false;
  const unique = new Set(text.toLowerCase().split(/\s+/));
  const repeated = [...unique].filter((w) => w.length > 1 && /^([a-z])\1*$/i.test(w)).length;
  if (repeated > 2) return false;
  return true;
}

/** Candidate verbatim quotes for a theme: complaints first, praise included. */
export function shortlistQuotes(
  tagged: TaggedReview[],
  theme: string,
  limit = QUOTE_CANDIDATES_PER_THEME,
): CandidateQuote[] {
  return tagged
    .filter((r) => r.theme === theme && isQuoteWorthy(r.text))
    .sort((a, b) => a.rating - b.rating || (a.date < b.date ? 1 : -1))
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      theme: r.theme,
      rating: r.rating,
      text: r.text,
      source: r.source,
      date: r.date,
    }));
}

export interface AggregateOptions {
  windowWeeks: number;
  quotesPerTheme?: number;
}

/** Full aggregate: stats, rankings, wow, and per-top-theme quote pools. */
export function aggregate(tagged: TaggedReview[], opts: AggregateOptions): AggregateResult {
  const all = computeThemeStats(tagged);
  const ranked = rankThemes(all);
  const top = ranked.slice(0, 3);

  const quotes: Record<string, CandidateQuote[]> = {};
  const perTheme = opts.quotesPerTheme ?? QUOTE_CANDIDATES_PER_THEME;
  for (const t of top) {
    quotes[t.theme] = shortlistQuotes(tagged, t.theme, perTheme);
  }

  return {
    windowWeeks: opts.windowWeeks,
    totalReviews: tagged.length,
    averageRating: average(tagged.map((r) => r.rating)),
    tagged: ranked.map((s) => ({ theme: s.theme, count: s.count, avgRating: s.avgRating })),
    quotes,
    wow: all.map((s) => ({ theme: s.theme, delta: s.wowDelta })),
  };
}