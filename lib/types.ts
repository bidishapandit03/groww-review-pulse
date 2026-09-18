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