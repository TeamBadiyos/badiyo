// Shared helpers for the training-mode admin endpoints (server-only).
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

export function preflight() {
  return new Response(null, { status: 204, headers: CORS });
}

/** Verifies the bearer token and that the caller is active staff with one of the roles. */
export async function requireStaff(request: Request, roles: string[]) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return { error: json({ error: "Not signed in" }, 401) } as const;
  const { data: userRes } = await supabaseAdmin.auth.getUser(token);
  const uid = userRes?.user?.id;
  if (!uid) return { error: json({ error: "Not signed in" }, 401) } as const;
  const { data: staff } = await supabaseAdmin
    .from("staff_users")
    .select("role")
    .eq("auth_user_id", uid)
    .eq("status", "active")
    .maybeSingle();
  if (!staff || !roles.includes(staff.role)) {
    return { error: json({ error: "Forbidden" }, 403) } as const;
  }
  return { supabase: supabaseAdmin, uid } as const;
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const b = await request.json();
    return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
