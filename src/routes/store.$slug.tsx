import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { storePendingStoreKey } from "@/lib/storeShare";

const ANDROID_PACKAGE = "com.badiyos.customer";
const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;

export const Route = createFileRoute("/store/$slug")({
  head: ({ params }) => {
    const pretty = params.slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const title = `${pretty} — Badiyos par order karein`;
    const description =
      "Ghar baithe is dukaan se saman order karein. Fast delivery seedhe aapke darwaze tak — Badiyos.";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  component: StoreLinkPage,
});

function StoreLinkPage() {
  const { slug } = useParams({ from: "/store/$slug" });
  const navigate = useNavigate();
  const [showStore, setShowStore] = useState(false);

  useEffect(() => {
    // Remember the shop first, so it survives an install detour or sign-in.
    storePendingStoreKey(slug);

    if (Capacitor.isNativePlatform() || !/android/i.test(navigator.userAgent)) {
      navigate({ to: "/", replace: true });
      return;
    }

    let handedOff = false;
    const onHide = () => {
      handedOff = true;
    };
    document.addEventListener("visibilitychange", onHide);

    const intentUrl =
      `intent://user.badiyos.com/store/${encodeURIComponent(slug)}#Intent;` +
      `scheme=https;package=${ANDROID_PACKAGE};` +
      `S.browser_fallback_url=${encodeURIComponent(PLAY_STORE_URL)};end`;
    window.location.href = intentUrl;

    const timer = setTimeout(() => {
      if (handedOff || document.hidden) return;
      setShowStore(true);
    }, 1500);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [slug, navigate]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-[max(24px,var(--app-safe-top))] text-center">
      <div className="max-w-sm">
        <h1 className="text-2xl font-extrabold text-foreground">Badiyos par dukaan khul rahi hai…</h1>
        <p className="mt-2 text-sm text-muted-foreground">Ek second rukein.</p>
        {showStore ? (
          <div className="mt-6 space-y-3">
            <a
              href={PLAY_STORE_URL}
              className="block rounded-[14px] bg-primary px-4 py-3.5 text-sm font-bold text-primary-foreground"
            >
              Badiyos app download karein
            </a>
            <button
              type="button"
              onClick={() => navigate({ to: "/", replace: true })}
              className="w-full rounded-[14px] border border-border bg-card px-4 py-3.5 text-sm font-bold text-foreground"
            >
              Browser me hi kholein
            </button>
          </div>
        ) : null}
      </div>
    </main>
  );
}
