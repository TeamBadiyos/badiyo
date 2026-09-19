import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { buildPlayStoreInviteUrl, captureReferralCode } from "@/lib/referrals";

const ANDROID_PACKAGE = "com.badiyos.customer";

export const Route = createFileRoute("/invite/$code")({
  head: ({ params }) => ({
    meta: [
      { title: `Join badiyos with code ${params.code}` },
      {
        name: "description",
        content:
          "You've been invited to badiyos — trusted home cleaning in Latur. Tap to claim your invite and get started.",
      },
      { property: "og:title", content: `Join badiyos with code ${params.code}` },
      {
        property: "og:description",
        content: "You've been invited to badiyos — trusted home cleaning in Latur.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: InvitePage,
});

function playStoreUrl(code: string) {
  const referrer = encodeURIComponent(`ref=${code}`);
  return `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}&referrer=${referrer}`;
}

function InvitePage() {
  const { code } = useParams({ from: "/invite/$code" });
  const navigate = useNavigate();
  const [showStore, setShowStore] = useState(false);

  useEffect(() => {
    // Always keep the code first, so it survives an install detour or sign-in.
    captureReferralCode();

    // Inside the installed app: nothing to hand off, just continue.
    if (Capacitor.isNativePlatform()) {
      navigate({ to: "/", replace: true });
      return;
    }

    const isAndroid = /android/i.test(navigator.userAgent);
    if (!isAndroid) {
      navigate({ to: "/", replace: true });
      return;
    }

    // Android browser: try to hand the link to the installed app; if nothing
    // takes it over, send the user to the Play Store carrying the code.
    let handedOff = false;
    const onHide = () => {
      handedOff = true;
    };
    document.addEventListener("visibilitychange", onHide);

    const intentUrl =
      `intent://user.badiyos.com/invite/${encodeURIComponent(code)}#Intent;` +
      `scheme=https;package=${ANDROID_PACKAGE};` +
      `S.browser_fallback_url=${encodeURIComponent(playStoreUrl(code))};end`;
    window.location.href = intentUrl;

    const timer = setTimeout(() => {
      if (handedOff || document.hidden) return;
      setShowStore(true);
    }, 1500);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [code, navigate]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 text-center">
      <div className="max-w-sm">
        <h1 className="text-2xl font-extrabold text-foreground">You're invited to badiyos</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your invite code <span className="font-bold text-primary">{code}</span> is saved.
        </p>
        {showStore ? (
          <div className="mt-6 space-y-3">
            <a
              href={playStoreUrl(code)}
              className="block rounded-[14px] bg-primary px-4 py-3.5 text-sm font-bold text-primary-foreground"
            >
              Get the badiyos app
            </a>
            <button
              type="button"
              onClick={() => navigate({ to: "/", replace: true })}
              className="w-full rounded-[14px] border border-border bg-card px-4 py-3.5 text-sm font-bold text-foreground"
            >
              Continue in browser
            </button>
          </div>
        ) : (
          <p className="mt-6 text-xs text-muted-foreground">Opening badiyos…</p>
        )}
      </div>
    </main>
  );
}
