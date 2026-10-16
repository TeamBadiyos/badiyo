import { useState } from "react";
import { Car, ChevronRight, Gift, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import type { ServiceState } from "@/lib/serviceHours";
import maidHero from "@/assets/clean-maid-hero.jpg";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getAuthUserId } from "@/lib/authUser";
import { pick, useBookNowAllowed, useNextFreeSlot, useServiceContent, useServiceHours, type BannerKey, type CleanServiceKey, type ContentCard, type ServiceContent } from "@/lib/serviceSettings";
import { useLanguage } from "@/i18n";
import { formatNextOpen } from "@/lib/serviceHours";
import type { SegmentService, ServiceCategory } from "@/lib/segments";
import type { SelectedSlot } from "../SlotSelectionScreen";
import { CL, CleanScheduleScreen } from "./CleanScheduleScreen";
import { CardDetailsSheet, ContentCardTile, type DetailItem } from "./parts";

import jhadu from "@/assets/expert-house-cleaning.jpg";
import bartan from "@/assets/expert-dishes.jpg";
import dusting from "@/assets/expert-dusting.jpg";
import washBike from "@/assets/wash-bike.jpg";
import washCar from "@/assets/wash-car.jpg";
import washCombo from "@/assets/wash-combo.jpg";

const T = {
  en: {
    refer: "Refer & Earn", referSub: "Invite friends, earn coins on their first booking",
    closedShort: "Closed now", opens: "Opens", available: "Available now", maid: "Maid", wash: "Car & Bike Wash", washCard: "Car Wash", maidDoes: "What the maid does", whatIncluded: "What is included?", today: "today", tomorrow: "tomorrow",
    maidHero: "Maid for Your Everyday Needs", washHero: "A Wash for Every Ride", button: "Book Now",
    maidCards: ["Daily Cleaning", "Kitchen Help", "Deep Cleaning"],
  },
  mr: {
    refer: "रेफर करा आणि कमवा", referSub: "मित्रांना बोलवा, त्यांच्या पहिल्या बुकिंगवर कॉइन्स मिळवा",
    closedShort: "सध्या बंद", opens: "उघडेल", available: "आता उपलब्ध", maid: "मावशी", wash: "कार आणि बाईक वॉश", washCard: "कार वॉश", maidDoes: "मावशी काय करेल", whatIncluded: "यात काय समाविष्ट आहे?", today: "आज", tomorrow: "उद्या",
    maidHero: "रोजच्या घरकामासाठी मावशी", washHero: "प्रत्येक गाडीसाठी वॉश", button: "बुक करा",
    maidCards: ["रोजची स्वच्छता", "किचन मदत", "सखोल स्वच्छता"],
  },
};
const MAID_IMG = [jhadu, bartan, dusting];

function washImage(label: string): string {
  const l = label.toLowerCase();
  if (l.includes("combo")) return washCombo;
  if (l.includes("bike")) return washBike;
  return washCar;
}

type Detail = { key: CleanServiceKey; items: DetailItem[]; index: number };

export function CleanTab({
  services, categories, addressLine, onChangeAddress, onCheckout, onOpenReferral,
}: {
  services: SegmentService[];
  categories: ServiceCategory[];
  promo?: { text?: string } | null;
  addressLine: string | null;
  onChangeAddress: (onReturn?: () => void) => void;
  onCheckout: (option: SegmentService, slot: SelectedSlot) => void;
  onOpenPromo?: () => void;
  onOpenReferral?: () => void;
}) {
  const { lang } = useLanguage();
  const s = lang === "mr" ? T.mr : T.en;
  const c = lang === "mr" ? CL.mr : CL.en;
  const { data: maidState } = useServiceHours("clean");
  const { data: washState } = useServiceHours("wash");
  const closed = maidState != null && !maidState.can_order;
  const nextOpen = closed ? formatNextOpen(maidState?.next_open_at ?? maidState?.resume_at) : null;
  const { data: maidContent } = useServiceContent("clean");
  const { data: washContent } = useServiceContent("wash");

  const autoCatIds = new Set(categories.filter((x) => /auto|wash/i.test(x.name)).map((x) => x.id));
  const byId = new Map(services.map((x) => [x.id, x]));

  // Server options override display (name, price, image); fallback to category split.
  const buildOptions = (content: ServiceContent | null | undefined, auto: boolean): SegmentService[] => {
    const list = (content?.options ?? [])
      .map((o) => {
        const base = byId.get(o.price_option_id);
        if (!base) return null;
        return {
          ...base,
          duration_label: pick(lang, o.name, o.name_mr) || base.duration_label,
          price: o.price ?? base.price,
          strikethrough_price: o.original_price ?? base.strikethrough_price,
          image_url: o.image_url || base.image_url,
        } as SegmentService;
      })
      .filter((x): x is SegmentService => !!x);
    if (list.length) return list;
    return services
      .filter((x) => autoCatIds.has(x.service_category_id ?? "") === auto)
      .sort((a, b) => Number(a.duration_minutes) - Number(b.duration_minutes));
  };
  const maidOptions = buildOptions(maidContent, false);
  const washOptions = buildOptions(washContent, true);

  type Draft = { auto: boolean; optionId: string | null; day: string | null; slotMins: number | null };
  const [draft, setDraft] = useState<Draft | null>(null);
  const [shown, setShown] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const openBooking = (auto: boolean, optionId?: string | null) => {
    setDetail(null);
    setDraft({ auto, optionId: optionId ?? null, day: null, slotMins: null });
    setShown(true);
  };
  const close = () => { setShown(false); setDraft(null); };
  const changeAddress = () => { setShown(false); onChangeAddress(() => setShown(true)); };

  const maidCards: ContentCard[] = maidContent?.cards?.length ? maidContent.cards : T.en.maidCards.map((t, i) => ({ title: t, title_mr: T.mr.maidCards[i] }));
  const washCards: ContentCard[] = washContent?.cards?.length
    ? washContent.cards
    : washOptions.map((o) => ({ title: o.duration_label, price_option_id: o.id }));

  const toItem = (card: ContentCard, image: string): DetailItem => ({
    image,
    title: pick(lang, card.title, card.title_mr),
    included: (lang === "mr" && card.included_mr?.length ? card.included_mr : card.included) ?? [],
    notIncluded: (lang === "mr" && card.not_included_mr?.length ? card.not_included_mr : card.not_included) ?? [],
    optionId: card.price_option_id ?? null,
  });
  const maidImg = (card: ContentCard, i: number) => card.image_url || MAID_IMG[i % MAID_IMG.length];
  const washImg = (card: ContentCard) => card.image_url || washOptions.find((o) => o.id === card.price_option_id)?.image_url || washImage(card.title ?? "");
  const openDetail = (key: CleanServiceKey, index: number) => setDetail({
    key, index,
    items: key === "wash" ? washCards.map((cd) => toItem(cd, washImg(cd))) : maidCards.map((cd, i) => toItem(cd, maidImg(cd, i))),
  });

  const { data: bookNow } = useBookNowAllowed("clean");
  const { data: firstName } = useQuery({
    queryKey: ["clean-first-name"],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const uid = await getAuthUserId();
      if (!uid) return "";
      const { data } = await supabase.from("users").select("full_name").eq("id", uid).maybeSingle();
      return String((data as { full_name?: string | null } | null)?.full_name ?? "").trim().split(/\s+/)[0] ?? "";
    },
  });
  const bannerKey = pickBanner(maidState, maidContent, bookNow?.allowed !== false);
  const banner = bannerKey === "campaign" ? maidContent?.campaign : maidContent?.banners?.[bannerKey];
  const { data: freeSlot } = useNextFreeSlot("clean", maidState, bannerKey === "open_busy");
  const nextAt = formatNextOpen(maidState?.next_open_at ?? maidState?.resume_at);
  const dayWord = !nextAt || !/[a-z]/i.test(nextAt.replace(/AM|PM/g, "")) ? s.today : nextAt.startsWith("tomorrow") ? s.tomorrow : nextAt.split(" ").slice(0, 2).join(" ");
  const vars = {
    greeting: greeting(lang), name: firstName ?? "",
    open_time: maidState?.open_time ? fmtTime(maidState.open_time) : (nextAt?.split(" ").slice(-2).join(" ") ?? ""),
    day: dayWord,
    next_slot: freeSlot ? (freeSlot.day === "today" ? freeSlot.label : `${s.tomorrow} ${freeSlot.label}`) : (nextAt ?? ""),
  };
  const bTitle = fill(pick(lang, banner?.title, banner?.title_mr), vars) || s.maidHero;
  const bSub = fill(pick(lang, banner?.subline, banner?.subline_mr), vars);
  const sky = bannerKey === "closed_evening" ? "var(--hero-night)" : bannerKey === "closed_morning" ? "var(--hero-morning)" : bannerKey === "holiday" ? "var(--hero-holiday)" : "var(--hero-day)";
  const statusLine = (st: typeof maidState) => {
    if (!st || st.can_order) return s.available;
    const n = formatNextOpen(st.next_open_at ?? st.resume_at);
    return n ? `${s.opens} ${n}` : s.closedShort;
  };

  return (
    <div>
      <section
        className="bleed-safe-top relative -mx-5 flex min-h-[35vh] flex-col items-center justify-center overflow-hidden px-6 pb-14 text-center"
        style={{ "--bleed-top-extra": "72px", background: banner?.image_url ? `center/cover no-repeat url("${banner.image_url}")` : sky } as React.CSSProperties}
      >
        <h1 className="text-2xl font-extrabold leading-tight text-hero-title drop-shadow">{bTitle}</h1>
        {bSub && <p className="mt-1.5 text-sm font-semibold text-primary-foreground/90 drop-shadow">{bSub}</p>}
      </section>

      <div className="relative -mx-5 -mt-8 rounded-t-[28px] bg-background px-5 pt-6">
        <div className="grid grid-cols-2 gap-3 pt-6">
          <ServiceCard title={pick(lang, maidContent?.hero?.card_title, maidContent?.hero?.card_title_mr) || s.maid} status={statusLine(maidState)} closed={closed} icon={<Sparkles className="h-4 w-4" />} img={maidContent?.hero?.image_url || maidHero} onClick={() => openBooking(false)} />
          {washOptions.length > 0 && (
            <ServiceCard title={pick(lang, washContent?.hero?.card_title, washContent?.hero?.card_title_mr) || s.washCard} status={statusLine(washState)} closed={washState != null && !washState.can_order} icon={<Car className="h-4 w-4" />} img={washContent?.hero?.image_url || washCar} onClick={() => openBooking(true)} />
          )}
        </div>

        {maidCards.length > 0 && (
          <>
            <h2 className="mt-7 text-lg font-extrabold text-foreground">{s.maidDoes}</h2>
            <div className="mt-3 grid grid-cols-3 gap-2.5">
              {maidCards.map((card, i) => {
                const img = card.image_url || MAID_IMG[i % MAID_IMG.length];
                return <ContentCardTile key={i} title={pick(lang, card.title, card.title_mr)} imageUrl={img} onClick={() => openDetail("clean", i)} />;
              })}
            </div>
          </>
        )}

        {washOptions.length > 0 && (
          <>
            <h2 className="mt-7 text-lg font-extrabold text-foreground">{s.wash}</h2>
            <div className="mt-3 grid grid-cols-3 gap-2.5">
              {washCards.map((card, i) => {
                const opt = washOptions.find((o) => o.id === card.price_option_id);
                const img = card.image_url || opt?.image_url || washImage(card.title ?? "");
                return <ContentCardTile key={i} title={pick(lang, card.title, card.title_mr)} imageUrl={img} price={opt ? Number(opt.price) : null} onClick={() => openDetail("wash", i)} />;
              })}
            </div>
          </>
        )}

        <button onClick={onOpenReferral} className="mt-7 flex w-full items-center gap-3 rounded-[18px] bg-card p-4 text-left shadow-soft">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary"><Gift className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-extrabold text-foreground">{s.refer}</p>
            <p className="text-xs text-muted-foreground">{s.referSub}</p>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </button>
      </div>

      {detail && (
        <CardDetailsSheet
          items={detail.items}
          index={detail.index}
          onIndex={(i) => setDetail((d) => (d ? { ...d, index: i } : d))}
          details={(detail.key === "wash" ? washContent : maidContent)?.details}
          lang={lang}
          heading={s.whatIncluded}
          bookLabel={c.bookNow}
          onClose={() => setDetail(null)}
          onBook={(it) => openBooking(detail.key === "wash", detail.key === "wash" ? it.optionId : null)}
        />
      )}

      {shown && draft && (
        <CleanScheduleScreen
          options={draft.auto ? washOptions : maidOptions}
          isAuto={draft.auto}
          serviceKey={draft.auto ? "wash" : "clean"}
          addressLine={addressLine}
          draft={{ optionId: draft.optionId, day: draft.day, slotMins: draft.slotMins }}
          fallbackImage={(o) => (draft.auto ? washImage(o.duration_label) : jhadu)}
          onDraftChange={(d) => setDraft((p) => (p ? { ...p, ...d } : p))}
          onChangeAddress={changeAddress}
          onBack={close}
          onContinue={(o, slot) => { close(); onCheckout(o, slot); }}
        />
      )}
    </div>
  );
}

function pickBanner(st: ServiceState | null | undefined, content: ServiceContent | null | undefined, nowAllowed: boolean): BannerKey | "campaign" {
  if (st && /holiday/i.test(st.reason_code ?? "")) return "holiday";
  if (!st || st.can_order) {
    const c = content?.campaign;
    if (c?.active && (c.title || c.image_url)) return "campaign";
    return nowAllowed ? "open_available" : "open_busy";
  }
  const now = new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour12: false }).slice(0, 5);
  const open = (st.open_time ?? "").slice(0, 5);
  return open && now < open ? "closed_morning" : "closed_evening";
}

function greeting(lang: string): string {
  const h = Number(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false }));
  if (lang === "mr") return h < 12 ? "सुप्रभात" : h < 17 ? "नमस्कार" : "शुभ संध्या";
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function fmtTime(t: string): string {
  const [hh, mm] = t.split(":").map(Number);
  if (!Number.isFinite(hh)) return t;
  const ap = hh >= 12 ? "PM" : "AM";
  const h12 = hh % 12 || 12;
  return mm ? `${h12}:${String(mm).padStart(2, "0")} ${ap}` : `${h12} ${ap}`;
}

function fill(text: string, vars: Record<string, string>): string {
  return text
    .replace(/,\s*\{name\}/g, vars.name ? `, ${vars.name}` : "")
    .replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "")
    .replace(/\s+·\s*$/, "")
    .trim();
}

function ServiceCard({ title, status, closed, icon, img, onClick }: { title: string; status: string; closed: boolean; icon: ReactNode; img: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="relative flex min-h-[104px] flex-col justify-end rounded-[18px] bg-card p-3 text-left shadow-soft transition active:scale-[0.98]">
      <img src={img} alt="" loading="lazy" className={`pointer-events-none absolute bottom-0 right-1 h-[125%] w-[45%] object-contain object-right-bottom ${closed ? "grayscale" : ""}`} />
      <div className="relative w-[55%] min-w-0">
        <span className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">{icon}</span>
        <span className="flex min-w-0 items-center text-sm font-extrabold text-foreground"><span className="truncate">{title}</span><ChevronRight className="h-4 w-4 shrink-0" /></span>
        <span className={`mt-0.5 block truncate text-[11px] font-semibold ${closed ? "text-muted-foreground" : "text-primary"}`}>{status}</span>
      </div>
    </button>
  );
}
