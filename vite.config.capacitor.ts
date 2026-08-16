// Capacitor / static build config.
// Produces a fully client-rendered SPA (single index.html + assets) with no
// server runtime: nitro is disabled and TanStack Start runs in SPA mode.
// Output: dist/client  -> use this as `webDir` in capacitor.config.ts
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  nitro: false,
  tanstackStart: {
    // Emit a static index.html shell and hydrate/route entirely on the client.
    spa: { enabled: true },
    prerender: { enabled: true },
    customViteReactPlugin: false,
  },
});
