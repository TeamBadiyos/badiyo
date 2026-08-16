import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { NATIVE_ORIGINS, serverFnFetch } from "./lib/nativeServerFn";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Allows the Capacitor WebView (which loads the SPA from a localhost/capacitor
// origin) to call this deployment's server functions. Browsers on the normal
// web deployment are same-origin and never send a matching Origin header, so
// nothing about the web behaviour changes.
const nativeCorsMiddleware = createMiddleware().server(async ({ request, next }) => {
  const origin = request.headers.get("origin");
  const allowed = origin != null && (NATIVE_ORIGINS as readonly string[]).includes(origin);
  if (!allowed) return next();

  const corsHeaders: Record<string, string> = {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers":
      request.headers.get("access-control-request-headers") ??
      "content-type,authorization,x-tsr-redirect",
    "access-control-max-age": "86400",
    vary: "origin",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const response = await next();
  const res = response instanceof Response ? response : (response as { response?: Response }).response;
  if (res instanceof Response) {
    for (const [k, v] of Object.entries(corsHeaders)) res.headers.set(k, v);
  }
  return response;
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [nativeCorsMiddleware, errorMiddleware],
  serverFns: { fetch: serverFnFetch },
}));

