/**
 * Admin gate for manual pipeline triggers. When ADMIN_PASSWORD is set, the
 * caller must send it as the x-admin-password header. With no password
 * configured (local/dev) the gate is open.
 */
export async function adminGate(request: Request): Promise<boolean> {
  const password = process.env.ADMIN_PASSWORD?.trim();
  if (!password) return true;
  return request.headers.get("x-admin-password") === password;
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}