import { adminGate, json } from "@/lib/pipeline/gate";
import { defaultStore, resetState } from "@/lib/pipeline/run";

export const dynamic = "force-dynamic";

/** Clear a stuck/in-flight run so the pipeline can start again. */
export async function POST(request: Request) {
  if (!(await adminGate(request))) return json({ ok: false, error: "unauthorized" }, 401);
  await resetState(defaultStore);
  return json({ ok: true, message: "pipeline state reset to idle" });
}