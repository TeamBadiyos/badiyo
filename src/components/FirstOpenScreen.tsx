import { useState } from "react";
import { Bell, Loader2, MapPin } from "lucide-react";
import { useLanguage } from "@/i18n";
import { getCurrentCoords } from "@/lib/nativeGeolocation";

export const FIRST_OPEN_KEY = "badiyos.firstOpenDone.v1";

const COPY = {
  en: {
    title: "Welcome to badiyos",
    sub: "Two quick permissions so we can serve you better.",
    loc: "Location",
    locSub: "Show services, stores and delivery near you.",
    notif: "Notifications",
    notifSub: "Booking, order and delivery updates.",
    cta: "Allow & continue",
    skip: "Not now",
  },
  mr: {
    title: "badiyos मध्ये स्वागत",
    sub: "तुम्हाला चांगली सेवा देण्यासाठी दोन परवानग्या.",
    loc: "लोकेशन",
    locSub: "जवळच्या सेवा, दुकाने आणि डिलिव्हरी दाखवण्यासाठी.",
    notif: "नोटिफिकेशन्स",
    notifSub: "बुकिंग, ऑर्डर आणि डिलिव्हरी अपडेट्स.",
    cta: "परवानगी द्या आणि पुढे चला",
    skip: "आत्ता नको",
  },
};

async function askNotifications() {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (Capacitor.isNativePlatform()) {
      const { PushNotifications } = await import("@capacitor/push-notifications");
      const perm = await PushNotifications.checkPermissions();
      if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
        await PushNotifications.requestPermissions();
      }
    } else if ("Notification" in window && Notification.permission === "default") {
      await Notification.requestPermission();
    }
  } catch {
    /* the customer can enable it later from settings */
  }
}

/** One screen on first open: Location + Notifications together. */
export function FirstOpenScreen({ onDone }: { onDone: () => void }) {
  const { lang } = useLanguage();
  const c = COPY[lang];
  const [busy, setBusy] = useState(false);

  const finish = () => {
    try {
      window.localStorage.setItem(FIRST_OPEN_KEY, "1");
    } catch {
      /* ignore */
    }
    onDone();
  };

  const allow = async () => {
    setBusy(true);
    await getCurrentCoords().catch(() => null);
    await askNotifications();
    setBusy(false);
    finish();
  };

  const Row = ({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) => (
    <div className="flex items-start gap-3 rounded-[20px] bg-card p-4 shadow-card-m">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        {icon}
      </div>
      <div>
        <p className="text-base font-extrabold text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{sub}</p>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-background px-6 pb-[calc(var(--app-safe-bottom)+24px)] pt-[calc(var(--app-safe-top,0px)+48px)]">
      <h1 className="text-3xl font-extrabold leading-tight text-foreground">{c.title}</h1>
      <p className="mt-2 text-base text-muted-foreground">{c.sub}</p>
      <div className="mt-8 space-y-3">
        <Row icon={<MapPin className="h-5 w-5" />} title={c.loc} sub={c.locSub} />
        <Row icon={<Bell className="h-5 w-5" />} title={c.notif} sub={c.notifSub} />
      </div>
      <div className="mt-auto space-y-2">
        <button
          onClick={allow}
          disabled={busy}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-[18px] bg-primary text-base font-extrabold text-primary-foreground active:scale-[0.99] disabled:opacity-70"
        >
          {busy && <Loader2 className="h-5 w-5 animate-spin" />}
          {c.cta}
        </button>
        <button onClick={finish} className="h-11 w-full text-sm font-bold text-muted-foreground">
          {c.skip}
        </button>
      </div>
    </div>
  );
}
