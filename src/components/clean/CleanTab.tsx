import { localSrc } from "@/lib/imageStore";
import { useEffect, useState } from "react";
import { ChevronRight, Gift } from "lucide-react";
import type { ServiceState } from "@/lib/serviceHours";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getAuthUserId } from "@/lib/authUser";
import { localizeState, pick, useBookNowAllowed, useNextFreeSlot, useServiceContent, useServiceHours, type BannerTextKey, type CleanServiceKey, type ContentCard, type ServiceContent, type BannerSlab } from "@/lib/serviceSettings";
import { useLanguage } from "@/i18n";
import { formatNextOpen } from "@/lib/serviceHours";
import type { SegmentService, ServiceCategory } from "@/lib/segments";
import type { SelectedSlot } from "@/lib/bookingTypes";
import { CL, CleanScheduleScreen } from "./CleanScheduleScreen";
import { getCleanDraft, setCleanDraft, type CleanBookingDraft } from "@/lib/cleanBookingDraft";
import { CardDetailsSheet, ContentCardTile, type DetailItem } from "./parts";

import { FadeImg } from "./parts";

const T = {
  en: {
    refer: "Refer & Earn", referSub: "Invite friends, earn badiyos Wallet money on their first booking",
    closedShort: "Closed now", opens: "Opens", available: "Open now", maid: "Maid", wash: "Car & Bike Wash", washCard: "Car Wash", maidDoes: "What the maid does", whatIncluded: "What is included?", today: "today", tomorrow: "tomorrow",
    maidHero: "Maid for Your Everyday Needs", washHero: "A Wash for Every Ride", button: "Book Now",
    maidCards: ["Daily Cleaning", "Kitchen Help", "Deep Cleaning"],
  },
  mr: {
    refer: "रेफर करा आणि कमवा", referSub: "मित्रांना बोलवा, त्यांच्या पहिल्या बुकिंगवर badiyos वॉलेटमध्ये पैसे मिळवा",
    closedShort: "सध्या बंद", opens: "उघडेल", available: "आता उपलब्ध", maid: "मावशी", wash: "कार आणि बाईक वॉश", washCard: "कार वॉश", maidDoes: "मावशी काय करेल", whatIncluded: "यात काय समाविष्ट आहे?", today: "आज", tomorrow: "उद्या",
    maidHero: "रोजच्या घरकामासाठी मावशी", washHero: "प्रत्येक गाडीसाठी वॉश", button: "बुक करा",
    maidCards: ["रोजची स्वच्छता", "किचन मदत", "सखोल स्वच्छता"],
  },
};
// Only Command Center photos are shown — no bundled fallback photos.
const MAID_IMG: string[] = [""];
function washImage(_label: string): string { return ""; }

type Detail = { key: CleanServiceKey; items: DetailItem[]; index: number };

export function CleanTab({
  services, categories, addressLine, onChangeAddress, onCheckout, onOpenReferral, onHeroTone,
}: {
  services: SegmentService[];
  categories: ServiceCategory[];
  promo?: { text?: string } | null;
  addressLine: string | null;
  onChangeAddress: (onReturn?: () => void) => void;
  onCheckout: (option: SegmentService, slot: SelectedSlot) => void | Promise<unknown>;
  onOpenPromo?: () => void;
  onOpenReferral?: () => void;
  onHeroTone?: (tone: "light" | "dark") => void;
}) {
  const { lang } = useLanguage();
  const s = lang === "mr" ? T.mr : T.en;
  const c = lang === "mr" ? CL.mr : CL.en;
  const { data: maidRaw, isPending: maidHoursPending } = useServiceHours("clean");
  const { data: washRaw } = useServiceHours("wash");
  const maidState = localizeState(maidRaw);
  const washState = localizeState(washRaw);
  const closed = maidState != null && !maidState.can_order;
  const nextOpen = closed ? formatNextOpen(maidState?.next_open_at ?? maidState?.resume_at) : null;
  const { data: maidContent, isPending: maidPending } = useServiceContent("clean");
  const { data: washContent, isPending: washPending } = useServiceContent("wash");
  const loading = maidPending || washPending || maidHoursPending;

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

  type Draft = CleanBookingDraft;
  // Restored from the shared draft so back from Checkout reopens the same booking page.
  const [draft, setDraftState] = useState<Draft | null>(() => getCleanDraft());
  const setDraft = (u: Draft | null | ((p: Draft | null) => Draft | null)) =>
    setDraftState((p) => {
      const n = typeof u === "function" ? u(p) : u;
      setCleanDraft(n);
      return n;
    });
  const shown = draft != null;
  // A preselected option decides Maid vs Wash (e.g. opened from search).
  const isWashDraft = draft?.optionId
    ? washOptions.some((o) => o.id === draft.optionId) || (!maidOptions.some((o) => o.id === draft.optionId) && draft.auto)
    : !!draft?.auto;
  const [detail, setDetail] = useState<Detail | null>(null);
  const openBooking = (auto: boolean, optionId?: string | null) => {
    setDetail(null);
    setDraft({ auto, optionId: optionId ?? null, day: null, slotMins: null });
  };
  const close = () => setDraft(null);
  // Address sheet opens on top of the booking page; booking stays underneath.
  const changeAddress = () => onChangeAddress();

  const maidCards: ContentCard[] = maidContent?.cards?.length ? maidContent.cards : T.en.maidCards.map((t, i) => ({ title: t, title_mr: T.mr.maidCards[i] }));
  const washCards: ContentCard[] = washContent?.cards?.length
    ? washContent.cards
    : washOptions.map((o) => ({ title: o.duration_label, price_option_id: o.id }));

  const lines = (arr: unknown): string[] => (Array.isArray(arr) ? arr : []).map((x) => {
    if (typeof x === "string") return x.trim();
    if (x && typeof x === "object") {
      const o = x as { en?: unknown; mr?: unknown };
      const en = typeof o.en === "string" ? o.en.trim() : "";
      const mr = typeof o.mr === "string" ? o.mr.trim() : "";
      return lang === "mr" ? mr || en : en || mr;
    }
    return "";
  }).filter(Boolean);
  const toItem = (card: ContentCard, image: string): DetailItem => ({
    image,
    title: pick(lang, card.title, card.title_mr),
    included: lines(lang === "mr" && card.included_mr?.length ? card.included_mr : card.included),
    notIncluded: lines(lang === "mr" && card.not_included_mr?.length ? card.not_included_mr : card.not_included),
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
  const banner = bannerKey === "campaign" ? maidContent?.campaign : maidContent?.banner?.texts?.[bannerKey];
  const { data: freeSlot } = useNextFreeSlot("clean", maidState, bannerKey === "open_busy");
  const nextAt = formatNextOpen(maidState?.next_open_at ?? maidState?.resume_at);
  const dayWord = dayLabel(maidState?.next_open_at ?? maidState?.resume_at, bannerKey, lang);
  const vars = {
    greeting: greeting(lang), name: firstName ?? "",
    open_time: maidState?.open_time ? fmtTime(maidState.open_time) : (nextAt?.split(" ").slice(-2).join(" ") ?? ""),
    day: dayWord,
    next_slot: freeSlot ? (freeSlot.day === "today" ? freeSlot.label : `${s.tomorrow} ${freeSlot.label}`) : (nextAt ?? ""),
  };
  const bTitle = fill(pick(lang, banner?.title, banner?.title_mr), vars) || s.maidHero;
  const bSub = fill(pick(lang, banner?.subline, banner?.subline_mr), vars);
  const slab = pickSlab(maidContent?.banner?.slabs);
  const heroImg = bannerKey === "campaign" ? (banner?.image_url || slab.image) : slab.image;
  const tone = slab.tone;
  useEffect(() => { onHeroTone?.(tone); }, [tone, onHeroTone]);
  const statusLine = (st: typeof maidState) => {
    if (!st) return "";
    if (st.can_order) return s.available;
    const n = shortOpenTime(st.next_open_at ?? st.resume_at);
    return n ? `${s.opens} ${n}` : s.closedShort;
  };

  return (
    <div>
      <section
        className="bleed-safe-top relative -mx-5 flex min-h-[35vh] flex-col items-center justify-center overflow-hidden px-6 pb-14 text-center"
        style={{ "--bleed-top-extra": "72px", background: heroImg ? `center/cover no-repeat url("${localSrc(heroImg)}"), ${slab.sky}` : slab.sky } as React.CSSProperties}
      >
        <h1 className={`text-2xl font-extrabold leading-tight ${tone === "light" ? "text-hero-title hero-shadow" : "text-hero-title-dark"}`}>{bTitle}</h1>
        {bSub && <p className={`mt-1.5 text-sm font-semibold ${tone === "light" ? "text-primary-foreground hero-shadow" : "text-hero-title-dark opacity-80"}`}>{bSub}</p>}
      </section>

      <div className="relative -mx-5 -mt-8 rounded-t-[28px] bg-background px-5 pt-3">
        {loading ? <CleanSkeleton /> : (<>
        <div className="grid grid-cols-2 gap-3 pt-[34px]">
          <ServiceCard title={pick(lang, maidContent?.hero?.card_title, maidContent?.hero?.card_title_mr) || s.maid} status={statusLine(maidState)} closed={!maidState || closed} img={maidContent?.hero?.image_url || ""} onClick={() => openBooking(false)} />
          {washOptions.length > 0 && (
            <ServiceCard title={pick(lang, washContent?.hero?.card_title, washContent?.hero?.card_title_mr) || s.washCard} status={statusLine(washState)} closed={!washState || !washState.can_order} img={washContent?.hero?.image_url || ""} onClick={() => openBooking(true)} />
          )}
        </div>

        {(maidCards.length > 0 || (washOptions.length > 0 && washCards.length > 0)) && (
          <>
            <h2 className="mt-7 text-lg font-extrabold text-foreground">
              {pick(lang, maidContent?.section_title, maidContent?.section_title_mr) || (lang === "mr" ? "आमचे एक्सपर्ट काय करतात" : "What our experts do")}
            </h2>
            <div className="mt-3 grid grid-cols-3 gap-2.5">
              {maidCards.slice(0, 3).map((card, i) => {
                const img = card.image_url || MAID_IMG[i % MAID_IMG.length];
                return <ContentCardTile key={`m${i}`} title={pick(lang, card.title, card.title_mr)} imageUrl={img} onClick={() => openDetail("clean", i)} />;
              })}
              {washOptions.length > 0 && washCards.slice(0, 3).map((card, i) => {
                const opt = washOptions.find((o) => o.id === card.price_option_id);
                const img = card.image_url || opt?.image_url || washImage(card.title ?? "");
                return <ContentCardTile key={`w${i}`} title={pick(lang, card.title, card.title_mr)} imageUrl={img} onClick={() => openDetail("wash", i)} />;
              })}
            </div>
          </>
        )}

        </>)}
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
          key={isWashDraft ? "wash" : "clean"}
          options={isWashDraft ? washOptions : maidOptions}
          isAuto={isWashDraft}
          serviceKey={isWashDraft ? "wash" : "clean"}
          title={isWashDraft
            ? pick(lang, washContent?.hero?.card_title, washContent?.hero?.card_title_mr) || s.wash
            : pick(lang, maidContent?.hero?.card_title, maidContent?.hero?.card_title_mr) || s.maid}
          addressLine={addressLine}
          draft={{ optionId: draft.optionId, day: draft.day, slotMins: draft.slotMins }}
          fallbackImage={(o) => ""}
          onDraftChange={(d) => setDraft((p) => (p ? { ...p, ...d } : p))}
          onChangeAddress={changeAddress}
          onBack={close}
          onContinue={(o, slot) => onCheckout(o, slot)}
        />
      )}
    </div>
  );
}

function pickBanner(st: ServiceState | null | undefined, content: ServiceContent | null | undefined, nowAllowed: boolean): BannerTextKey | "campaign" {
  const c = content?.campaign;
  if (c?.active && (c.title || c.image_url)) return "campaign";
  if (st && /holiday/i.test(st.reason_code ?? "")) return "holiday";
  if (!st || st.can_order) {
    return nowAllowed ? "open_free" : "open_busy";
  }
  return "closed";
}

function greeting(lang: string): string {
  const h = Number(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false }));
  if (lang === "mr") return h >= 5 && h < 12 ? "सुप्रभात" : h >= 12 && h < 17 ? "शुभ दुपार" : h >= 17 && h < 21 ? "शुभ संध्याकाळ" : "शुभ रात्री";
  return h >= 5 && h < 12 ? "Good Morning" : h >= 12 && h < 17 ? "Good Afternoon" : h >= 17 && h < 21 ? "Good Evening" : "Good Night";
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

function ServiceCard({ title, status, closed, img, onClick }: { title: string; status: string; closed: boolean; img: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="relative flex min-h-[96px] flex-col justify-end overflow-visible rounded-[18px] bg-card p-2.5 text-left service-glow transition active:scale-[0.98]">
      {img && <FadeImg src={img} className="pointer-events-none absolute bottom-0 right-0 h-[135%] w-auto max-w-none object-contain object-bottom" />}
      <div className="relative w-[46%] min-w-0">
        <span className="break-words text-[20px] font-extrabold leading-[1.12] tracking-tight text-foreground">
          {title}
          {"\u00A0"}
          <span className="whitespace-nowrap text-[18px] font-bold text-foreground">›</span>
        </span>
        <span className={`mt-1 flex items-center gap-1 whitespace-nowrap text-[11px] font-semibold leading-none ${closed ? "text-muted-foreground" : "text-primary"}`}>
          {!closed && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />}
          <span>{status}</span>
        </span>
      </div>
    </button>
  );
}

/** "tomorrow 9:00 AM" -> "9 AM"; keeps minutes when they aren't :00. */
function shortOpenTime(iso: string | null | undefined): string | null {
  const n = formatNextOpen(iso);
  if (!n) return null;
  return n.replace(/\b(\d{1,2}):00\b/g, "$1").split(" ").slice(-2).join(" ");
}

function dayLabel(iso: string | null | undefined, banner: string, lang: string): string {
  const mr = lang === "mr";
  const tz = "Asia/Kolkata";
  const key = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: tz });
  const now = new Date();
  const today = key(now);
  const tomorrow = key(new Date(now.getTime() + 86_400_000));
  const d = iso ? new Date(iso) : null;
  if (d && !Number.isNaN(d.getTime())) {
    const k = key(d);
    if (k <= today) return mr ? "आज" : "today";
    if (k === tomorrow) return mr ? "उद्या" : "tomorrow";
    return d.toLocaleDateString(mr ? "mr-IN" : "en-IN", { timeZone: tz, day: "numeric", month: "short" });
  }
  const h = Number(now.toLocaleString("en-US", { timeZone: tz, hour: "numeric", hour12: false })) % 24;
  if (banner === "closed" && h >= 12) return mr ? "उद्या" : "tomorrow";
  return mr ? "आज" : "today";
}

const DEFAULT_SLABS: { from: string; to: string; sky: string; tone: "light" | "dark" }[] = [
  { from: "05:00", to: "08:00", sky: "var(--hero-sunrise)", tone: "dark" },
  { from: "08:00", to: "17:00", sky: "var(--hero-day)", tone: "dark" },
  { from: "17:00", to: "21:00", sky: "var(--hero-evening)", tone: "light" },
  { from: "21:00", to: "05:00", sky: "var(--hero-night)", tone: "light" },
];

function inSlab(now: string, from?: string | null, to?: string | null): boolean {
  const f = (from ?? "").slice(0, 5).padStart(5, "0");
  const t = (to ?? "").slice(0, 5).padStart(5, "0");
  if (!from || !to) return false;
  return f <= t ? now >= f && now < t : now >= f || now < t;
}

function pickSlab(slabs: BannerSlab[] | null | undefined): { image: string | null; sky: string; tone: "light" | "dark" } {
  const now = new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour12: false }).slice(0, 5).replace(/^24/, "00");
  const def = DEFAULT_SLABS.find((d) => inSlab(now, d.from, d.to)) ?? DEFAULT_SLABS[1];
  const cc = (slabs ?? []).find((x) => inSlab(now, x.from, x.to));
  return { image: cc?.image_url || null, sky: def.sky, tone: (cc?.text_color as "light" | "dark") || def.tone };
}

function CleanSkeleton() {
  const sh = "animate-pulse rounded-[16px] bg-muted";
  return (
    <div aria-hidden>
      <div className="grid grid-cols-2 gap-3 pt-[34px]">
        <div className={`h-[96px] ${sh} rounded-[18px]`} />
        <div className={`h-[96px] ${sh} rounded-[18px]`} />
      </div>
      {[0, 1].map((k) => (
        <div key={k}>
          <div className={`mt-7 h-6 w-40 ${sh} rounded-md`} />
          <div className="mt-3 grid grid-cols-3 gap-2.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="overflow-hidden rounded-[16px] border border-border bg-card">
                <div className="aspect-square w-full animate-pulse bg-muted" />
                <div className="p-2"><div className="h-3 w-3/4 animate-pulse rounded bg-muted" /><div className="mt-1.5 h-4 w-1/2 animate-pulse rounded bg-muted" /></div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
