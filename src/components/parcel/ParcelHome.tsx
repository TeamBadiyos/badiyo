// Parcel tab home: premium hero (like Clean), Porter-style pickup/drop card,
// service cards, "what can you send" tiles and trust row. Tapping starts the
// full-screen step flow (Pickup → Drop → Vehicle → Goods → Checkout).
import { useQuery } from "@tanstack/react-query";
import { Bike, ChevronRight, Clock, FileText, Gift, Pill, Route, ShieldCheck, Shirt, ShoppingBasket, Soup, MapPin } from "lucide-react";
import { toast } from "sonner";
import type { SavedAddress } from "@/components/LocationPickerSheet";
import { BrandWatermark } from "@/components/BrandWatermark";
import { useLanguage } from "@/i18n";
import { formatNextOpen, useServiceState } from "@/lib/serviceHours";
import { fetchCourierEnabled } from "@/components/courier/courierData";
import { fill, useParcelCopy } from "./parcelCopy";
import { addrTitle, emptyDraft, hasCoords, writeDraft, type ParcelAddr } from "./parcelDraft";

const T = {
  en: {
    title: "Send anything, anywhere in the city", sub: "Doorstep pickup · Live tracking · OTP delivery",
    bike: "Bike Delivery", bikeSub: "Fast single drop", multi: "Multi-Stop", multiSub: "Send to many places",
    what: "What can you send?", items: ["Documents", "Tiffin & Food", "Medicines", "Groceries", "Clothes", "Gifts"],
    trust: ["OTP verified", "Live GPS", "Safe handling"],
  },
  mr: {
    title: "शहरात कुठेही, काहीही पाठवा", sub: "दारातून पिकअप · लाईव्ह ट्रॅकिंग · OTP डिलिव्हरी",
    bike: "बाईक डिलिव्हरी", bikeSub: "जलद एक ड्रॉप", multi: "मल्टी-स्टॉप", multiSub: "अनेक ठिकाणी पाठवा",
    what: "तुम्ही काय पाठवू शकता?", items: ["कागदपत्रे", "डबा आणि जेवण", "औषधे", "किराणा", "कपडे", "भेटवस्तू"],
    trust: ["OTP सत्यापित", "लाईव्ह GPS", "सुरक्षित हाताळणी"],
  },
};
const ICONS = [FileText, Soup, Pill, ShoppingBasket, Shirt, Gift];

export function ParcelHome({
  pickup: defaultPickup,
  onStart,
}: {
  pickup: SavedAddress | null;
  onChangePickup?: () => void;
  onStart: () => void;
}) {
  const c = useParcelCopy();
  const { lang } = useLanguage();
  const s = lang === "mr" ? T.mr : T.en;
  const { data: enabled = true } = useQuery({ queryKey: ["courier_enabled"], queryFn: () => fetchCourierEnabled(), staleTime: 5 * 60_000 });
  const { data: state } = useServiceState("courier");
  const opensAt = state && !state.open ? formatNextOpen(state.next_open_at ?? state.resume_at) : null;
  const pickupAddr: ParcelAddr | null = hasCoords(defaultPickup) ? defaultPickup : null;

  const start = (mode: "single" | "multiDrop") => {
    if (!enabled) {
      toast(c.comingSoon);
      return;
    }
    const d = emptyDraft(pickupAddr);
    d.mode = mode;
    writeDraft(d);
    onStart();
  };

  return (
    <div>
      <section
        className="bleed-safe-top relative -mx-5 flex min-h-[calc(30vh)] flex-col justify-end overflow-hidden px-6 pb-14 parcel-hero"
        style={{ "--bleed-top-extra": "72px" } as React.CSSProperties}
      >
        <h1 className="text-2xl font-extrabold leading-tight text-foreground">{s.title}</h1>
        <p className="mt-1.5 text-sm font-semibold text-muted-foreground">{s.sub}</p>
        {opensAt && (
          <p className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-full bg-card/80 px-3 py-1 text-xs font-bold text-muted-foreground">
            <Clock className="h-3.5 w-3.5" /> {fill(c.opens, { t: opensAt })}
          </p>
        )}
      </section>

      <div className="relative -mx-5 -mt-8 rounded-t-[28px] bg-background px-5 pt-5">
        {/* Porter-style unified pickup / drop card */}
        <div className="service-glow rounded-[20px] border border-primary/20 p-4 shadow-soft">
          <button type="button" onClick={() => start("single")} className="flex w-full items-center gap-3 text-left">
            <span className="h-3 w-3 shrink-0 rounded-full bg-primary ring-4 ring-primary/20" />
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{c.pickup}</span>
              <span className="block truncate text-[15px] font-extrabold text-foreground">{pickupAddr ? addrTitle(pickupAddr) : c.wherePickup}</span>
            </span>
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          </button>
          <div className="my-2 ml-[5px] h-5 border-l-2 border-dashed border-border" />
          <button type="button" onClick={() => start("single")} className="flex w-full items-center gap-3 rounded-[14px] bg-card px-3 py-3 text-left shadow-soft">
            <span className="h-3 w-3 shrink-0 rounded-full bg-destructive ring-4 ring-destructive/20" />
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{c.drop}</span>
              <span className="block truncate text-[15px] font-extrabold text-foreground">{c.whereTo}</span>
            </span>
            <MapPin className="h-5 w-5 text-primary" />
          </button>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3">
          {([
            { t: s.bike, sub: s.bikeSub, Icon: Bike, mode: "single" as const },
            { t: s.multi, sub: s.multiSub, Icon: Route, mode: "multiDrop" as const },
          ]).map(({ t, sub, Icon, mode }) => (
            <button key={t} type="button" onClick={() => start(mode)} className="service-glow relative flex min-h-[110px] flex-col justify-between overflow-hidden rounded-[18px] border border-primary/20 p-3 text-left transition active:scale-[0.98]">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary"><Icon className="h-6 w-6" /></span>
              <span>
                <span className="block text-[17px] font-extrabold leading-tight text-foreground">{t} ›</span>
                <span className="mt-0.5 block text-[11px] font-semibold text-primary">{sub}</span>
              </span>
            </button>
          ))}
        </div>

        <h2 className="mt-8 text-lg font-extrabold text-foreground">{s.what}</h2>
        <div className="mt-3 grid grid-cols-3 gap-2.5">
          {s.items.map((label, i) => {
            const Icon = ICONS[i];
            return (
              <button key={label} type="button" onClick={() => start("single")} className="flex flex-col items-center gap-2 rounded-[16px] border border-border bg-card px-2 py-4 shadow-soft">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary"><Icon className="h-6 w-6" /></span>
                <span className="text-center text-xs font-bold text-foreground">{label}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-6 flex items-center justify-around rounded-[16px] bg-primary/5 px-3 py-3">
          {s.trust.map((t) => (
            <span key={t} className="flex items-center gap-1 text-[11px] font-bold text-primary">
              <ShieldCheck className="h-4 w-4" /> {t}
            </span>
          ))}
        </div>

        <BrandWatermark />
      </div>
    </div>
  );
}
