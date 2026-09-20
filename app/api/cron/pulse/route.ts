import { ConflictError, runPulse } from "@/lib/pipeline/run";
import { adminGate, json } from "@/lib/pipeline/gate";

export const dynamic = "force-dynamic";
/** Hobby-plan ceiling; weekly increments are small enough to fit. */
export const maxDuration = 60;

function isCronCall(request: Request): boolean {
  return request.headers.get("x-vercel-cron") === "1" || Boolean(request.headers.get("authorization"));
}

/**
 * Weekly pulse. GET is the Vercel cron entry (vercel.json: 0 9 * * 1) or an
 * authenticated manual trigger; POST is the on-demand "Run pipeline" button.
 */
export async function GET(request: Request) {
  if (!isCronCall(request) && !(await adminGate(request))) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  try {
    const outcome = await runPulse();
    return json({ ok: true, ...outcome });
  } catch (err) {
    const status = err instanceof ConflictError ? 409 : 500;
    return json({ ok: false, error: errMessage(err) }, status);
  }
}

export async function POST(request: Request) {
  if (!(await adminGate(request))) return json({ ok: false, error: "unauthorized" }, 401);
  try {
    const outcome = await runPulse();
    return json({ ok: true, ...outcome });
  } catch (err) {
    const status = err instanceof ConflictError ? 409 : 500;
    return json({ ok: false, error: errMessage(err) }, status);
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}