// CORS for drop-proof endpoints called from other Badiyos apps. Never "*".
const ALLOWED = new Set([
  "https://expert.badiyos.com",
  "https://merchant.badiyos.com",
  "https://badiyos.com",
  "https://user.badiyos.com",
  "https://localhost",
  "capacitor://localhost",
]);

export function proofCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin || !ALLOWED.has(origin)) return { Vary: "Origin" };
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function proofPreflight(request: Request): Response {
  const origin = request.headers.get("origin");
  if (!origin || !ALLOWED.has(origin)) return new Response(null, { status: 403, headers: { Vary: "Origin" } });
  return new Response(null, { status: 204, headers: proofCorsHeaders(request) });
}

export function proofJson(request: Request, body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: proofCorsHeaders(request) });
}
