import { MapPinOff, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/i18n";
import { openAppSettings } from "@/lib/nativeGeolocation";
import { useBackHandler } from "@/lib/backHandler";

const TXT = {
  en: { title: "Location access needed", body: "We use your location to place the pin on your address and match you with nearby experts. You can also enter your address yourself.", manual: "Enter address manually", settings: "Open settings", none: "Please allow location for badiyos in your phone settings." },
  mr: { title: "लोकेशनची परवानगी हवी", body: "तुमच्या पत्त्यावर पिन ठेवण्यासाठी आणि जवळचे एक्सपर्ट शोधण्यासाठी आम्ही लोकेशन वापरतो. तुम्ही पत्ता स्वतःही टाकू शकता.", manual: "पत्ता स्वतः टाका", settings: "सेटिंग्ज उघडा", none: "फोनच्या सेटिंग्जमध्ये badiyos ला लोकेशनची परवानगी द्या." },
};

/** Shown when the phone refused location permission. */
export function LocationDeniedScreen({ onEnterManually }: { onEnterManually: () => void; onBack?: () => void }) {
  const { lang } = useLanguage();
  const s = TXT[lang === "mr" ? "mr" : "en"];
  useBackHandler(true, onEnterManually);
  return (
    <main className="fixed inset-0 z-[60] w-full bg-background">
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col items-center justify-center px-6 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
          <MapPinOff className="h-10 w-10 text-primary" />
        </div>
        <h1 className="mt-6 text-xl font-extrabold text-foreground">{s.title}</h1>
        <p className="mt-2 max-w-xs text-sm text-muted-foreground">{s.body}</p>
        <button
          onClick={async () => { const ok = await openAppSettings(); if (!ok) toast.info(s.none); }}
          className="mt-8 flex w-full max-w-xs items-center justify-center gap-2 rounded-[14px] bg-primary px-6 py-3.5 text-sm font-extrabold text-primary-foreground active:scale-[0.99]"
        >
          <Settings2 className="h-4 w-4" />{s.settings}
        </button>
        <button onClick={onEnterManually} className="mt-3 w-full max-w-xs rounded-[14px] border-2 border-primary px-6 py-3 text-sm font-extrabold text-primary">
          {s.manual}
        </button>
      </div>
    </main>
  );
}
