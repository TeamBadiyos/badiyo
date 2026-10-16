import { useState } from "react";
import { Car, ChevronRight, Gift, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import type { ServiceState } from "@/lib/serviceHours";
import maidHero from "@/assets/clean-maid-hero.jpg";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { pick, useServiceContent, useServiceHours, type CleanServiceKey, type ContentCard, type ServiceContent } from "@/lib/serviceSettings";
import { useLanguage } from "@/i18n";
import { formatNextOpen } from "@/lib/serviceHours";
import type { SegmentService, ServiceCategory } from "@/lib/segments";
import type { SelectedSlot } from "../SlotSelectionScreen";
import { CL, CleanScheduleScreen } from "./CleanScheduleScreen";
import { ContentCardTile } from "./parts";

import jhadu from "@/assets/expert-house-cleaning.jpg";
import bartan from "@/assets/expert-dishes.jpg";
import dusting from "@/assets/expert-dusting.jpg";
import washBike from "@/assets/wash-bike.jpg";
import washCar from "@/assets/wash-car.jpg";
import washCombo from "@/assets/wash-combo.jpg";

const T = {
  en: {
    refer: "Refer & Earn", referSub: "Invite friends, earn coins on their first booking",
    closedShort: "Closed now", opens: "Opens", available: "Available now", maid: "Maid", wash: "Car & Bike Wash", maidDoes: "What the maid does",
    maidHero: "Maid for Your Everyday Needs", washHero: "A Wash for Every Ride", button: "Book Now",
    maidCards: ["Daily Cleaning", "Kitchen Help", "Deep Cleaning"],
  },
  mr: {
    refer: "रेफर करा आणि कमवा", referSub: "मित्रांना बोलवा, त्यांच्या पहिल्या बुकिंगवर कॉइन्स मिळवा",
    closedShort: "सध्या बंद", opens: "उघडेल", available: "आता उपलब्ध", maid: "मावशी", wash: "कार आणि बाईक वॉश", maidDoes: "मावशी काय करेल",
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

type Detail = { key: CleanServiceKey; title: string; image: string; included: string[]; notIncluded: string[]; optionId: string | null };

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

  const cardDetail = (key: CleanServiceKey, card: ContentCard, image: string): Detail => ({
    key, image,
    title: pick(lang, card.title, card.title_mr),
    included: (lang === "mr" && card.included_mr?.length ? card.included_mr : card.included) ?? [],
    notIncluded: (lang === "mr" && card.not_included_mr?.length ? card.not_included_mr : card.not_included) ?? [],
    optionId: card.price_option_id ?? null,
  });

  const bannerKey = pickBanner(maidState, maidContent);
  const banner = bannerKey === "campaign" ? (maidContent as WithBanners | null | undefined)?.campaign : (maidContent as WithBanners | null | undefined)?.banners?.[bannerKey];
  const vars = {
    greeting: greeting(lang), name: "", open_time: maidState?.open_time ? fmtTime(maidState.open_time) : (nextOpen ?? ""),
    day: nextOpen?.split(" ").length === 3 ? nextOpen.split(" ").slice(0, 2).join(" ") : (nextOpen?.includes("tomorrow") ? (lang === "mr" ? "उद्या" : "tomorrow") : (lang === "mr" ? "आज" : "today")),
    next_slot: nextOpen ?? "",
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
          <ServiceCard title={s.maid} status={statusLine(maidState)} closed={closed} icon={<Sparkles className="h-4 w-4" />} img={maidContent?.hero?.image_url || maidHero} onClick={() => openBooking(false)} />
          {washOptions.length > 0 && (
            <ServiceCard title={s.wash} status={statusLine(washState)} closed={washState != null && !washState.can_order} icon={<Car className="h-4 w-4" />} img={washContent?.hero?.image_url || washCar} onClick={() => openBooking(true)} />
          )}
        </div>

        {maidCards.length > 0 && (
          <>
            <h2 className="mt-7 text-lg font-extrabold text-foreground">{s.maidDoes}</h2>
            <div className="mt-3 grid grid-cols-3 gap-2.5">
              {maidCards.map((card, i) => {
                const img = card.image_url || MAID_IMG[i % MAID_IMG.length];
                return <ContentCardTile key={i} title={pick(lang, card.title, card.title_mr)} imageUrl={img} onClick={() => setDetail(cardDetail("clean", card, img))} />;
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
                return <ContentCardTile key={i} title={pick(lang, card.title, card.title_mr)} imageUrl={img} price={opt ? Number(opt.price) : null} onClick={() => setDetail(cardDetail("wash", card, img))} />;
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

      <Sheet open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto rounded-t-[24px] px-5 pb-6 safe-bottom">
          {detail && (
            <>
              <img src={detail.image} alt={detail.title} className="mt-4 aspect-[4/3] w-full rounded-[18px] bg-muted object-cover" />
              <SheetTitle className="mt-4 text-xl font-extrabold text-foreground">{detail.title}</SheetTitle>
              {detail.included.length > 0 && (
                <div className="mt-3">
                  <p className="text-sm font-extrabold text-foreground">{c.included}</p>
                  <ul className="mt-1 space-y-1">{detail.included.map((x, i) => <li key={i} className="text-sm text-foreground"><span className="font-bold text-primary">✓</span> {x}</li>)}</ul>
                </div>
              )}
              {detail.notIncluded.length > 0 && (
                <div className="mt-3">
                  <p className="text-sm font-extrabold text-foreground">{c.notIncluded}</p>
                  <ul className="mt-1 space-y-1">{detail.notIncluded.map((x, i) => <li key={i} className="text-sm text-muted-foreground"><span className="font-bold text-destructive">✗</span> {x}</li>)}</ul>
                </div>
              )}
              <button onClick={() => openBooking(detail.key === "wash", detail.optionId)} className="mt-5 w-full rounded-[16px] bg-primary py-4 text-base font-extrabold text-primary-foreground">
                {c.bookNow}
              </button>
            </>
          )}
        </SheetContent>
      </Sheet>

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

type Banner = { title?: string; title_mr?: string; subline?: string; subline_mr?: string; image_url?: string | null };
type WithBanners = ServiceContent & { banners?: Record<string, Banner>; campaign?: Banner & { active?: boolean; enabled?: boolean } };

function pickBanner(st: ServiceState | null | undefined, content: ServiceContent | null | undefined): string {
  const c = content as WithBanners | null | undefined;
  if (c?.campaign?.active && c.campaign.enabled && (c.campaign.title || c.campaign.image_url)) return "campaign";
  if (st && /holiday/i.test(st.reason_code ?? "")) return "holiday";
  if (!st || st.can_order) return "open_available";
  const h = Number(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false }));
  return h < 12 ? "closed_morning" : "closed_evening";
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
    <button onClick={onClick} className="relative flex min-h-[112px] flex-col justify-end rounded-[18px] bg-card p-3 pr-[42%] text-left shadow-soft transition active:scale-[0.98]">
      <img src={img} alt="" loading="lazy" className={`pointer-events-none absolute -top-7 right-1 h-[130px] w-[44%] rounded-[14px] object-cover object-top ${closed ? "grayscale" : ""}`} />
      <span className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">{icon}</span>
      <span className="flex items-center text-sm font-extrabold text-foreground">{title}<ChevronRight className="h-4 w-4 shrink-0" /></span>
      <span className={`mt-0.5 text-[11px] font-semibold ${closed ? "text-muted-foreground" : "text-primary"}`}>{status}</span>
    </button>
  );
}
