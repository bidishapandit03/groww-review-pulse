import type { RunMeta } from "@/lib/types";
import type { PipelineStep } from "@/lib/constants";
import { z } from "zod";

export const CORPUS_KEY = "pipeline/corpus.json";
export const REDACT_KEY = "pipeline/redacted.json";
export const STATE_KEY = "pipeline/state.json";
export const TAGGED_KEY = "pipeline/tagged.json";
export const AGGREGATE_KEY = "pipeline/aggregate.json";
export const NOTE_KEY = "pipeline/note.json";
export const EMAIL_KEY = "pipeline/email.json";

export interface PipelineState {
  runId: string;
  createdAt: string;
  updatedAt: string;
  windowWeeks: number;
  /** last step that completed successfully */
  step: PipelineStep | "idle";
  meta: RunMeta;
  lastError: string | null;
}

export const pipelineRunSchema = z.object({
  runId: z.string(),
  createdAt: z.string(),
  step: z.enum(["import", "redact", "tag", "aggregate", "note", "email", "idle"]),
  windowWeeks: z.number(),
  meta: z.object({
    runId: z.string(),
    startedAt: z.string(),
    windowWeeks: z.number(),
    stores: z.array(z.enum(["appstore", "playstore"])),
    reviewsImported: z.number(),
    reviewsAfterRedaction: z.number(),
    coverage: z.record(z.string(), z.string().nullable()),
  }),
  lastError: z.string().nullable(),
});

export interface AggregateResult {
  windowWeeks: number;
  totalReviews: number;
  averageRating: number;
  tagged: { theme: string; count: number; avgRating: number }[];
  quotes: Record<string, CandidateQuote[]>;
  wow: { theme: string; delta: number | null }[];
}

export interface CandidateQuote {
  id: string;
  theme: string;
  rating: number;
  text: string;
  source: string;
  date: string;
}

export type { RunMeta, PipelineStep };