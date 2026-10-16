import { useState } from "react";
import { isImageLoaded } from "@/lib/serviceSettings";
import { localSrc } from "@/lib/imageStore";
import { Check, Droplets, MapPin, Package, X } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import type { ContentDetails } from "@/lib/serviceSettings";
import type { SegmentService } from "@/lib/segments";

export function AddressLine({ text, changeLabel, addLabel, onChange }: { text: string | null; changeLabel: string; addLabel: string; onChange: () => void }) {
  return (
    <button onClick={onChange} className="flex w-full items-center gap-2 text-left text-sm">
      <MapPin className="h-4 w-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1 truncate font-bold text-foreground">{text || addLabel}</span>
      <span className="font-extrabold text-primary">{changeLabel}</span>
    </button>
  );
}

export function DurationCard({
  option, active, full, popularLabel, fullLabel, onClick, className = "",
}: {
  option: SegmentService; active: boolean; full?: boolean; popularLabel: string; fullLabel: string; onClick: () => void; className?: string;
}) {
  const price = Number(option.price);
  const old = Number(option.strikethrough_price);
  const popular = Number(option.duration_minutes) === 120;
  return (
    <button
      disabled={full}
      onClick={onClick}
      className={`relative flex flex-col items-start rounded-[16px] border-2 p-3 pt-4 text-left transition ${
        full ? "border-border bg-muted opacity-60" : active ? "border-primary bg-primary/5" : "border-border bg-card"
      } ${className}`}
    >
      {popular && !full && (
        <span className="absolute -top-2 left-2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-extrabold text-primary-foreground">{popularLabel}</span>
      )}
      {full && (
        <span className="absolute -top-2 left-2 rounded-full bg-muted-foreground px-2 py-0.5 text-[10px] font-extrabold text-background">{fullLabel}</span>
      )}
      <span className="text-sm font-bold text-foreground">{option.duration_label}</span>
      <span className="mt-1 text-lg font-extrabold text-foreground">₹{price}</span>
      {old > price && <span className="text-xs text-muted-foreground line-through">₹{old}</span>}
    </button>
  );
}

export function DayCard({ label, sub, active, onClick }: { label: string; sub: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-[80px] shrink-0 flex-col items-center rounded-[16px] border-2 px-3 py-3 ${
        active ? "border-primary bg-primary/5" : "border-border bg-card"
      }`}
    >
      <span className={`text-sm text-foreground ${active ? "font-extrabold" : "font-bold"}`}>{label}</span>
      <span className="mt-0.5 text-xs font-semibold text-muted-foreground">{sub}</span>
    </button>
  );
}

/** Green calendar with a "Full" tag — drawn with theme colours. */
export function FullCalendarArt({ fullLabel }: { fullLabel: string }) {
  return (
    <svg viewBox="0 0 120 110" className="mx-auto h-28 w-32" aria-hidden>
      <rect x="10" y="18" width="90" height="80" rx="14" className="fill-primary/10 stroke-primary" strokeWidth="3" />
      <rect x="10" y="18" width="90" height="22" rx="10" className="fill-primary" />
      <rect x="30" y="8" width="6" height="18" rx="3" className="fill-primary" />
      <rect x="74" y="8" width="6" height="18" rx="3" className="fill-primary" />
      {[0, 1, 2].map((r) =>
        [0, 1, 2, 3].map((c) => (
          <rect key={`${r}${c}`} x={22 + c * 18} y={50 + r * 14} width="10" height="8" rx="2" className="fill-primary/40" />
        )),
      )}
      <g transform="rotate(-12 88 82)">
        <rect x="62" y="70" width="52" height="22" rx="11" className="fill-destructive" />
        <text x="88" y="86" textAnchor="middle" className="fill-destructive-foreground" fontSize="12" fontWeight="800">{fullLabel}</text>
      </g>
    </svg>
  );
}

export function HeroCard({ heading, subline, button, imageUrl, bgColor, onClick }: { heading: string; subline: string; button: string; imageUrl?: string | null; bgColor?: string | null; onClick: () => void }) {
  const dark = !!bgColor;
  return (
    <button onClick={onClick} style={bgColor ? { backgroundColor: bgColor } : undefined} className={`relative flex min-h-[150px] w-full overflow-hidden rounded-[22px] p-5 text-left shadow-card-m ${dark ? "" : "bg-surface-soft"}`}>
      <div className={`relative z-10 flex flex-1 flex-col ${imageUrl ? "max-w-[60%]" : ""}`}>
        {heading ? (
          <>
            <p className={`text-xl font-extrabold leading-tight ${dark ? "text-primary-foreground" : "text-foreground"}`}>{heading}</p>
            {subline && <p className={`mt-1 text-sm font-semibold ${dark ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{subline}</p>}
          </>
        ) : (
          <p className={`text-xl font-extrabold leading-tight ${dark ? "text-primary-foreground" : "text-foreground"}`}>{subline}</p>
        )}
        <span className="mt-auto inline-flex w-fit rounded-full bg-background px-4 py-2 text-sm font-extrabold text-foreground">{button}</span>
      </div>
      {imageUrl && <img src={imageUrl} alt="" className="pointer-events-none absolute bottom-0 right-0 h-full max-w-[45%] object-contain object-bottom" />}
    </button>
  );
}

export function ContentCardTile({ title, imageUrl, price, onClick }: { title: string; imageUrl: string; price?: number | null; onClick: () => void }) {
  return (
    <button onClick={onClick} className="overflow-hidden rounded-[16px] border border-border bg-card text-left active:scale-[0.98]">
      <div className="aspect-square w-full bg-muted">{imageUrl && <FadeImg src={imageUrl} alt={title} width={500} height={500} className="h-full w-full object-cover" />}</div>
      <div className="p-2">
        <p className="truncate text-xs font-bold text-foreground">{title}</p>
        {price != null && <p className="text-sm font-extrabold text-primary">₹{price}</p>}
      </div>
    </button>
  );
}

export function OptionImageCard({ name, imageUrl, price, original, active, onClick }: { name: string; imageUrl: string; price: number; original?: number | null; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`overflow-hidden rounded-[16px] border-2 text-left ${active ? "border-primary bg-primary/5" : "border-border bg-card"}`}>
      <div className="aspect-square w-full bg-muted">{imageUrl && <FadeImg src={imageUrl} alt={name} width={500} height={500} className="h-full w-full object-cover" />}</div>
      <div className="p-2">
        <p className="truncate text-xs font-bold text-foreground">{name}</p>
        <p className="text-base font-extrabold text-foreground">₹{price}
          {original != null && original > price && <span className="ml-1 text-xs font-semibold text-muted-foreground line-through">₹{original}</span>}
        </p>
      </div>
    </button>
  );
}

export type DetailItem = { title: string; image: string; included: string[]; notIncluded: string[]; optionId: string | null };

export function CardDetailsSheet({ items, index, onIndex, details, lang, heading, bookLabel, onClose, onBook }: {
  items: DetailItem[]; index: number | null; onIndex: (i: number) => void; details?: ContentDetails | null; lang: string;
  heading: string; bookLabel: string; onClose: () => void; onBook: (item: DetailItem) => void;
}) {
  const item = index != null ? items[index] : null;
  const mr = lang === "mr";
  const t = (en?: string | null, m?: string | null, fb = "") => ((mr && m?.trim() ? m : en)?.trim() || fb);
  const incTitle = t(details?.included_title, details?.included_title_mr, mr ? "एक्सपर्ट हे करेल" : "The expert will do");
  const excTitle = t(details?.excluded_title, details?.excluded_title_mr, mr ? "यात समाविष्ट नाही" : "Not included");
  const note = t(details?.note, details?.note_mr);
  const NoteIcon = details?.note_icon === "water" ? Droplets : Package;
  return (
    <Sheet open={!!item} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-[24px] px-5 pb-6 safe-bottom">
        {item && (
          <>
            <SheetTitle className="mt-2 text-xl font-extrabold text-foreground">{heading}</SheetTitle>
            {items.length > 1 && (
              <div className="-mx-5 mt-3 flex gap-2 overflow-x-auto px-5 pb-1">
                {items.map((it, i) => (
                  <button key={i} onClick={() => onIndex(i)} className={`flex shrink-0 items-center gap-2 rounded-full border-2 py-1 pl-1 pr-3 text-xs font-bold ${i === index ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-foreground"}`}>
                    <img src={it.image} alt="" className="h-7 w-7 rounded-full object-cover" />
                    {it.title}
                  </button>
                ))}
              </div>
            )}
            <img src={item.image} alt={item.title} className="mt-3 aspect-[4/3] w-full rounded-[18px] bg-muted object-cover" />
            <p className="mt-3 text-lg font-extrabold text-foreground">{item.title}</p>
            {item.included.length > 0 && (
              <div className="mt-3">
                <p className="text-sm font-extrabold text-foreground">{incTitle}</p>
                <ul className="mt-1.5 space-y-1.5">{item.included.map((x, i) => <li key={i} className="flex gap-2 text-sm text-foreground"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{x}</li>)}</ul>
              </div>
            )}
            {item.notIncluded.length > 0 && (
              <div className="mt-3">
                <p className="text-sm font-extrabold text-foreground">{excTitle}</p>
                <ul className="mt-1.5 space-y-1.5">{item.notIncluded.map((x, i) => <li key={i} className="flex gap-2 text-sm text-muted-foreground"><X className="mt-0.5 h-4 w-4 shrink-0 text-warning" />{x}</li>)}</ul>
              </div>
            )}
            {note && (
              <div className="mt-4 flex items-start gap-3 rounded-[14px] bg-surface-soft p-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><NoteIcon className="h-4 w-4" /></span>
                <p className="text-sm font-semibold text-foreground">{note}</p>
              </div>
            )}
            <button onClick={() => onBook(item)} className="mt-5 w-full rounded-[16px] bg-primary py-4 text-base font-extrabold text-primary-foreground">{bookLabel}</button>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Image that fades in once loaded; instant if already preloaded. */
export function FadeImg({ src, alt = "", className = "", width, height }: { src: string; alt?: string; className?: string; width?: number; height?: number }) {
  const [instant] = useState(() => isImageLoaded(src));
  const [ok, setOk] = useState(instant);
  const [s, setS] = useState(() => localSrc(src));
  return (
    <img src={s} alt={alt} width={width} height={height} decoding={instant ? "sync" : "async"} onLoad={() => setOk(true)}
      onError={() => { if (s !== src) setS(src); }}
      className={`${className} ${instant ? "" : "transition-opacity duration-300"} ${ok ? "opacity-100" : "opacity-0"}`} />
  );
}
