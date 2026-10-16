import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { pick, useServiceContent, useServiceHours, type CleanServiceKey, type ContentCard, type ServiceContent } from "@/lib/serviceSettings";
import { useLanguage } from "@/i18n";
import { formatNextOpen } from "@/lib/serviceHours";
import type { SegmentService, ServiceCategory } from "@/lib/segments";
import type { SelectedSlot } from "../SlotSelectionScreen";
import { CL, CleanScheduleScreen } from "./CleanScheduleScreen";
import { ContentCardTile, HeroCard } from "./parts";

import jhadu from "@/assets/expert-house-cleaning.jpg";
import bartan from "@/assets/expert-dishes.jpg";
import dusting from "@/assets/expert-dusting.jpg";
import washBike from "@/assets/wash-bike.jpg";
import washCar from "@/assets/wash-car.jpg";
import washCombo from "@/assets/wash-combo.jpg";

const T = {
  en: {
    refer: "Refer & Earn", referSub: "Invite friends, earn coins on their first booking",
    closed: "🕐 Closed now", opens: "Opens",
    maidHero: "Maid for Your Everyday Needs", washHero: "A Wash for Every Ride", button: "Book Now",
    maidCards: ["Daily Cleaning", "Kitchen Help", "Deep Cleaning"],
  },
  mr: {
    refer: "रेफर करा आणि कमवा", referSub: "मित्रांना बोलवा, त्यांच्या पहिल्या बुकिंगवर कॉइन्स मिळवा",
    closed: "🕐 सध्या बंद", opens: "उघडेल",
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
  const { data: state } = useServiceHours("clean");
  const closed = state != null && !state.can_order;
  const nextOpen = closed ? formatNextOpen(state?.next_open_at ?? state?.resume_at) : null;
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

  const hero = (content: ServiceContent | null | undefined, fallbackSub: string, key: CleanServiceKey) => {
    const h = content?.hero;
    return (
      <HeroCard
        heading={pick(lang, h?.heading, h?.heading_mr)}
        subline={pick(lang, h?.subline, h?.subline_mr) || fallbackSub}
        button={pick(lang, h?.button, h?.button_mr) || s.button}
        imageUrl={h?.image_url}
        bgColor={h?.bg_color}
        onClick={() => openBooking(key === "wash")}
      />
    );
  };

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

  return (
    <div className="mt-1">
      {closed && (
        <p className="mb-3 rounded-[14px] bg-muted px-4 py-2.5 text-sm font-bold text-foreground">
          {s.closed}{nextOpen ? ` · ${s.opens} ${nextOpen}` : ""}
        </p>
      )}

      {hero(maidContent, s.maidHero, "clean")}
      {maidCards.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2.5">
          {maidCards.map((card, i) => {
            const img = card.image_url || MAID_IMG[i % MAID_IMG.length];
            return <ContentCardTile key={i} title={pick(lang, card.title, card.title_mr)} imageUrl={img} onClick={() => setDetail(cardDetail("clean", card, img))} />;
          })}
        </div>
      )}

      {washOptions.length > 0 && (
        <>
          <div className="mt-6">{hero(washContent, s.washHero, "wash")}</div>
          <div className="mt-3 grid grid-cols-3 gap-2.5">
            {washCards.map((card, i) => {
              const opt = washOptions.find((o) => o.id === card.price_option_id);
              const title = pick(lang, card.title, card.title_mr);
              const img = card.image_url || opt?.image_url || washImage(card.title ?? "");
              return <ContentCardTile key={i} title={title} imageUrl={img} price={opt ? Number(opt.price) : null} onClick={() => setDetail(cardDetail("wash", card, img))} />;
            })}
          </div>
        </>
      )}

      <button onClick={onOpenReferral} className="mt-6 flex w-full items-center gap-3 rounded-[18px] bg-surface-soft p-4 text-left">
        <span className="text-2xl">🎁</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-extrabold text-foreground">{s.refer}</p>
          <p className="text-xs text-muted-foreground">{s.referSub}</p>
        </div>
        <ChevronRight className="h-5 w-5 text-muted-foreground" />
      </button>

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
