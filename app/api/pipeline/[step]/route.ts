import { PIPELINE_STEPS } from "@/lib/constants";
import { adminGate, json } from "@/lib/pipeline/gate";
import { ConflictError, readState, runSingleStep } from "@/lib/pipeline/run";
import { defaultStore } from "@/lib/pipeline/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = Promise<{ step?: string }>;

function isPipelineStep(step: string | undefined): step is (typeof PIPELINE_STEPS)[number] {
  return Boolean(step && (PIPELINE_STEPS as readonly string[]).includes(step));
}

/** Current status of the step (no PII, never triggers work). */
export async function GET(_request: Request, context: { params: Params }) {
  const { step } = (await context.params) ?? {};
  if (!isPipelineStep(step)) return json({ ok: false, error: "unknown step" }, 400);
  const state = await readState(defaultStore);
  return json({
    ok: true,
    step,
    state: state
      ? { runId: state.runId, step: state.step, lastError: state.lastError, updatedAt: state.updatedAt }
      : null,
  });
}

/** Run exactly this step (manual per-step trigger, admin-gated). */
export async function POST(request: Request, context: { params: Params }) {
  if (!(await adminGate(request))) return json({ ok: false, error: "unauthorized" }, 401);
  const { step } = (await context.params) ?? {};
  if (!isPipelineStep(step)) return json({ ok: false, error: "unknown step" }, 400);
  try {
    const result = await runSingleStep(step);
    return json({ ok: true, step, summary: result.summary });
  } catch (err) {
    const status = err instanceof ConflictError ? 409 : 500;
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, status);
  }
}