import { ACTION_OWNERS, OTHER_BUCKET, THEME_IDS } from "@/lib/constants";
import { z } from "zod";

/** Reviews are normalized to these four fields. Author/username is never stored. */
export const reviewSchema = z.object({
  id: z.string(),
  source: z.enum(["appstore", "playstore"]),
  rating: z.number().int().min(1).max(5),
  title: z.string(),
  text: z.string(),
  /** ISO date, e.g. 2026-09-14 */
  date: z.string(),
});

export type Review = z.infer<typeof reviewSchema>;
export const ReviewListSchema = z.array(reviewSchema);

/** One of the 5 fixed themes, or the hidden "other" bucket. */
export const tagThemeSchema = z.enum([...THEME_IDS, OTHER_BUCKET]);
export type TagTheme = z.infer<typeof tagThemeSchema>;

/** A review that has been assigned exactly one theme. */
export const taggedReviewSchema = reviewSchema.extend({ theme: tagThemeSchema });
export type TaggedReview = z.infer<typeof taggedReviewSchema>;
export const TaggedReviewListSchema = z.array(taggedReviewSchema);

export const actionOwnerSchema = z.enum(ACTION_OWNERS);
export type ActionOwner = z.infer<typeof actionOwnerSchema>;

/** One ranked theme in the note, summarized by the LLM with code-computed stats. */
export const themeSummarySchema = z.object({
  theme: tagThemeSchema,
  summary: z.string(),
});
export type ThemeSummary = z.infer<typeof themeSummarySchema>;

/** One action idea: concrete step + owner + metric to watch. */
export const noteActionSchema = z.object({
  action: z.string(),
  owner: actionOwnerSchema,
  metric: z.string(),
});
export type NoteAction = z.infer<typeof noteActionSchema>;

/**
 * Validated weekly note. quoteIds are review ids the LLM selected; the exact
 * quote text is inserted by code so quotes are always verbatim and verified.
 */
export const noteSchema = z.object({
  weekLabel: z.string(),
  generatedAt: z.string(),
  themes: z.array(themeSummarySchema).length(3),
  quoteIds: z.array(z.string()).length(3),
  actions: z.array(noteActionSchema).length(3),
  /** computed in code over the rendered body, never by the LLM */
  wordCount: z.number().int().min(0),
});
export type Note = z.infer<typeof noteSchema>;

export interface ImportResult {
  reviews: Review[];
  /** oldest raw date fetched per store, used to verify window coverage */
  coverage: Record<string, string | null>;
}

/** Visible output of a pipeline run (store this; contains zero PII). */
export const runMetaSchema = z.object({
  runId: z.string(),
  startedAt: z.string(),
  windowWeeks: z.number(),
  stores: z.array(z.enum(["appstore", "playstore"])),
  reviewsImported: z.number(),
  reviewsAfterRedaction: z.number(),
  coverage: z.record(z.string(), z.string().nullable()),
});

export type RunMeta = z.infer<typeof runMetaSchema>;

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}