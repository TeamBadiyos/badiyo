import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Gift, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getAuthUser } from "@/lib/authUser";
import { useLanguage } from "@/i18n";
import { formatNextOpen, useServiceState } from "@/lib/serviceHours";
import type { SegmentService, ServiceCategory } from "@/lib/segments";
import type { SelectedSlot } from "../SlotSelectionScreen";
import { CleanBookSheet, type CleanSheetMode } from "./CleanBookSheet";

import maidHero from "@/assets/clean-maid-hero.jpg";
import jhadu from "@/assets/expert-house-cleaning.jpg";
import pocha from "@/assets/clean-pocha.jpg";
import bartan from "@/assets/expert-dishes.jpg";
import dusting from "@/assets/expert-dusting.jpg";
import kapde from "@/assets/clean-kapde.jpg";
import more from "@/assets/clean-more.jpg";
import washBike from "@/assets/wash-bike.jpg";
import washCar from "@/assets/wash-car.jpg";
import washCombo from "@/assets/wash-combo.jpg";

const T = {
  en: {
    bookNow: "Book Now", bookNowSub: "Abhi bulao",
    schedule: "Schedule", scheduleSub: "Time chuno",
    wash: "🚗 Car & Bike Wash",
    oneMaid: "Ek maid, saare kaam",
    tiles: ["Jhadu", "Pocha", "Bartan", "Dusting", "Kapde", "Aur bhi"],
    again: "🔁 Book again",
    refer: "Refer & Earn", referSub: "Invite friends, earn coins on their first booking",
    closed: "🕐 Closed now", opens: "Opens",
  },
  mr: {
    bookNow: "आत्ता बुक करा", bookNowSub: "लगेच बोलवा",
    schedule: "वेळ ठरवा", scheduleSub: "वेळ निवडा",
    wash: "🚗 कार आणि बाईक वॉश",
    oneMaid: "एक मेड, सगळी कामे",
    tiles: ["झाडू", "पोछा", "भांडी", "डस्टिंग", "कपडे", "आणखी"],
    again: "🔁 पुन्हा बुक करा",
    refer: "रेफर करा आणि कमवा", referSub: "मित्रांना बोलवा, त्यांच्या पहिल्या बुकिंगवर कॉइन्स मिळवा",
    closed: "🕐 सध्या बंद", opens: "उघडेल",
  },
};
const TILE_IMG = [jhadu, pocha, bartan, dusting, kapde, more];

function washImage(label: string): string {
  const l = label.toLowerCase();
  if (l.includes("combo")) return washCombo;
  if (l.includes("bike")) return washBike;
  return washCar;
}

export function CleanTab({
  services,
  categories,
  promo,
  addressLine,
  onChangeAddress,
  onCheckout,
  onOpenPromo,
  onOpenReferral,
}: {
  services: SegmentService[];
  categories: ServiceCategory[];
  promo?: { text?: string } | null;
  addressLine: string | null;
  onChangeAddress: () => void;
  onCheckout: (option: SegmentService, slot: SelectedSlot) => void;
  onOpenPromo?: () => void;
  onOpenReferral?: () => void;
}) {
  const { lang } = useLanguage();
  const s = lang === "mr" ? T.mr : T.en;
  const { data: state } = useServiceState("clean");
  const closed = state != null && !state.can_order;
  const nextOpen = closed ? formatNextOpen(state?.next_open_at ?? state?.resume_at) : null;

  const autoCatIds = new Set(categories.filter((c) => /auto|wash/i.test(c.name)).map((c) => c.id));
  const homeOptions = services
    .filter((x) => !autoCatIds.has(x.service_category_id ?? ""))
    .sort((a, b) => Number(a.duration_minutes) - Number(b.duration_minutes));
  const autoOptions = services.filter((x) => autoCatIds.has(x.service_category_id ?? ""));

  const [sheet, setSheet] = useState<{ mode: CleanSheetMode; auto: boolean; optionId?: string | null } | null>(null);
  const open = (mode: CleanSheetMode, auto: boolean, optionId?: string | null) =>
    setSheet({ mode: closed ? "later" : mode, auto, optionId });

  const { data: lastBooking } = useQuery({
    queryKey: ["clean_last_booking"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data: u } = await getAuthUser();
      if (!u.user) return null;
      const { data } = await supabase
        .from("bookings")
        .select("price_option_id, service_label, created_at")
        .eq("user_id", u.user.id)
        .not("price_option_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1);
      return data?.[0] ?? null;
    },
  });
  const againOption = lastBooking ? services.find((x) => x.id === lastBooking.price_option_id) : null;

  return (
    <div className="mt-1">
      {closed && (
        <p className="mb-3 rounded-[14px] bg-muted px-4 py-2.5 text-sm font-bold text-foreground">
          {s.closed}
          {nextOpen ? ` · ${s.opens} ${nextOpen}` : ""}
        </p>
      )}

      {/* Two big cards */}
      <div className="grid grid-cols-2 gap-3">
        {!closed && (
          <button onClick={() => open("now", false)} className="overflow-hidden rounded-[20px] bg-primary text-left text-primary-foreground shadow-card-m active:scale-[0.98]">
            <img src={maidHero} alt="" width={816} height={816} className="aspect-[4/3] w-full object-cover object-top" />
            <div className="p-3">
              <p className="text-base font-extrabold">⚡ {s.bookNow}</p>
              <p className="text-xs font-semibold opacity-90">{s.bookNowSub}</p>
            </div>
          </button>
        )}
        <button onClick={() => open("later", false)} className={`overflow-hidden rounded-[20px] border border-border bg-card text-left shadow-card-m active:scale-[0.98] ${closed ? "col-span-2" : ""}`}>
          <img src={maidHero} alt="" width={816} height={816} className={`w-full object-cover object-top ${closed ? "aspect-[2/1]" : "aspect-[4/3]"}`} />
          <div className="p-3">
            <p className="text-base font-extrabold text-foreground">🕐 {s.schedule}</p>
            <p className="text-xs font-semibold text-muted-foreground">{s.scheduleSub}</p>
          </div>
        </button>
      </div>

      {/* Car & Bike Wash */}
      {autoOptions.length > 0 && (
        <>
          <h2 className="mt-6 text-lg font-extrabold text-foreground">{s.wash}</h2>
          <div className="mt-2 grid grid-cols-3 gap-2.5">
            {autoOptions.map((o) => (
              <button key={o.id} onClick={() => open("now", true, o.id)} className="overflow-hidden rounded-[16px] border border-border bg-card text-left active:scale-[0.98]">
                <img src={washImage(o.duration_label)} alt={o.duration_label} loading="lazy" width={816} height={816} className="aspect-square w-full object-cover" />
                <div className="p-2">
                  <p className="truncate text-xs font-bold text-foreground">{o.duration_label.replace(/\s*wash/i, "")}</p>
                  <p className="text-sm font-extrabold text-primary">₹{Number(o.price)}</p>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {/* Offer card */}
      {promo?.text && (
        <button onClick={onOpenPromo} className="surface-brand mt-6 flex w-full items-center gap-3 rounded-[18px] p-4 text-left shadow-card-m">
          <Gift className="h-6 w-6 shrink-0 text-primary-foreground" />
          <p className="flex-1 text-sm font-bold leading-snug text-primary-foreground">{promo.text}</p>
          <ChevronRight className="h-5 w-5 text-primary-foreground" />
        </button>
      )}

      {/* One maid, all work */}
      <h2 className="mt-6 text-lg font-extrabold text-foreground">{s.oneMaid}</h2>
      <div className="mt-2 grid grid-cols-3 gap-2.5">
        {s.tiles.map((label, i) => (
          <div key={label} className="overflow-hidden rounded-[16px] bg-card">
            <img src={TILE_IMG[i]} alt={label} loading="lazy" width={512} height={512} className="aspect-square w-full rounded-[16px] object-cover" />
            <p className="mt-1.5 text-center text-xs font-bold text-foreground">{label}</p>
          </div>
        ))}
      </div>

      {/* Book again */}
      {againOption && (
        <button
          onClick={() => (closed ? open("later", autoCatIds.has(againOption.service_category_id ?? ""), againOption.id) : onCheckout(againOption, { mode: "now" }))}
          className="mt-6 flex w-full items-center gap-3 rounded-[18px] border border-border bg-card p-4 text-left"
        >
          <RotateCcw className="h-6 w-6 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-extrabold text-foreground">{s.again}</p>
            <p className="truncate text-xs text-muted-foreground">
              {againOption.service_name} · {againOption.duration_label} · ₹{Number(againOption.price)}
            </p>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </button>
      )}

      {/* Refer & Earn */}
      <button onClick={onOpenReferral} className="mt-4 flex w-full items-center gap-3 rounded-[18px] bg-surface-soft p-4 text-left">
        <span className="text-2xl">🎁</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-extrabold text-foreground">{s.refer}</p>
          <p className="text-xs text-muted-foreground">{s.referSub}</p>
        </div>
        <ChevronRight className="h-5 w-5 text-muted-foreground" />
      </button>

      <CleanBookSheet
        open={!!sheet}
        mode={sheet?.mode ?? "now"}
        onModeChange={(m) => setSheet((p) => (p ? { ...p, mode: closed ? "later" : m } : p))}
        options={sheet?.auto ? autoOptions : homeOptions}
        initialOptionId={sheet?.optionId}
        isAuto={sheet?.auto}
        addressLine={addressLine}
        onChangeAddress={onChangeAddress}
        onClose={() => setSheet(null)}
        onContinue={(o, slot) => {
          setSheet(null);
          onCheckout(o, slot);
        }}
      />
    </div>
  );
}
