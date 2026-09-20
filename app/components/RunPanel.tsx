"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Props {
  adminRequired: boolean;
}

export default function RunPanel({ adminRequired }: Props) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/cron/pulse", {
        method: "POST",
        headers: adminRequired ? { "x-admin-password": password } : {},
      });
      const data = (await res.json()) as { ok?: boolean; runId?: string; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setMessage(`Run ${data.runId} finished — the page now shows live data.`);
      setPassword("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="runPanel" data-testid="run-panel">
      <p className="runIntro">
        <b>Rerun for a new week:</b> fetch fresh reviews, tag the new ones, and rebuild the
        note. Same as the Monday cron, but on-demand.
      </p>
      {adminRequired && (
        <input
          type="password"
          className="runPw"
          placeholder="Admin password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-label="Admin password"
        />
      )}
      <button className="btnSend runBtn" onClick={run} disabled={busy || (adminRequired && !password)}>
        {busy ? "Running…" : "Run weekly pipeline now"}
      </button>
      {message && <p className="runMsg ok">{message}</p>}
      {error && <p className="runMsg err">{error}</p>}
    </div>
  );
}