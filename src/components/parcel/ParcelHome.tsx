// Parcel tab home: premium hero (like Clean) and one Pickup/Drop card.
// Tapping a row opens the address sheet, then a small details sheet
// (flat/floor + name + phone). When both are complete, "Select vehicle" opens
// the full-screen Vehicle page; "+ Add stop" opens the multi-stop editor.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Clock, MapPin, X } from "lucide-react";
import { toast } from "sonner";
import { LocationPickerSheet, type SavedAddress } from "@/components/LocationPickerSheet";
import { BrandWatermark } from "@/components/BrandWatermark";
import { useLanguage } from "@/i18n";
import { formatNextOpen, useServiceState } from "@/lib/serviceHours";
import { fetchCourierEnabled } from "@/components/courier/courierData";
import { getAuthUser } from "@/lib/authUser";
import { useBackHandler } from "@/lib/backHandler";
import { fill, useParcelCopy } from "./parcelCopy";
import {
  addrTitle, emptyDraft, fetchMe, hasCoords, phone10, readDraft, readRecentDrops, setParcelEntry, writeDraft,
  type ParcelAddr, type ParcelDraft, type ParcelStop,
} from "./parcelDraft";
import { useServiceContent } from "@/lib/serviceSettings";
import { localSrc } from "@/lib/imageStore";
import { pickSlab, useIstMinute } from "@/components/clean/CleanTab";

const T = {
  en: { title: "Send anything, anywhere in the city", sub: "Doorstep pickup · Live tracking · OTP delivery", pickupTitle: "Select pickup location", dropTitle: "Select drop location" },
  mr: { title: "शहरात कुठेही, काहीही पाठवा", sub: "दारातून पिकअप · लाईव्ह ट्रॅकिंग · OTP डिलिव्हरी", pickupTitle: "पिकअप लोकेशन निवडा", dropTitle: "ड्रॉप लोकेशन निवडा" },
};

const complete = (st?: ParcelStop) => !!st && hasCoords(st.addr) && st.name.trim().length > 0 && phone10(st.phone).length === 10;

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
  // Parcel banner photos/text from Command Center (courier); built-in sky fallback.
  const { data: heroContent } = useServiceContent("courier");
  const baseSlab = pickSlab(heroContent?.banner?.slabs, useIstMinute());
  const camp = heroContent?.campaign;
  const campOn = !!(camp?.active && (camp.title || camp.image_url));
  const slab = campOn ? { ...baseSlab, image: camp?.image_url || baseSlab.image } : baseSlab;
  const hero = heroContent?.hero;
  const isMr = lang === "mr";
  const title = (campOn ? (isMr && camp?.title_mr) || camp?.title : (isMr && hero?.heading_mr) || hero?.heading) || s.title;
  const sub = (campOn ? (isMr && camp?.subline_mr) || camp?.subline : (isMr && hero?.subline_mr) || hero?.subline) || s.sub;
  const heroImg = slab.image;
  const tone = slab.tone;

  const [draft, setDraft] = useState<ParcelDraft>(() => readDraft() ?? emptyDraft(hasCoords(defaultPickup) ? defaultPickup : null));
  const save = (fn: (d: ParcelDraft) => ParcelDraft) =>
    setDraft((d) => {
      const n = fn(d);
      writeDraft(n);
      return n;
    });
  const [picker, setPicker] = useState<"pickup" | "drop" | null>(null);
  const [details, setDetails] = useState<"pickup" | "drop" | null>(null);

  const pickupStop = draft.stops.find((x) => x.key === "P1") ?? draft.stops.find((x) => x.type === "pickup");
  const dropStop = draft.stops.find((x) => x.type === "drop");
  const pickupAddr = pickupStop?.addr ?? null;
  const dropAddr = dropStop?.addr ?? null;
  const keyOf = (w: "pickup" | "drop") => (w === "pickup" ? pickupStop?.key : dropStop?.key);

  // Pickup defaults to the selected address and the customer's own name + number.
  const { data: uid } = useQuery({ queryKey: ["auth-user-id"], queryFn: async () => (await getAuthUser()).data.user?.id ?? null, staleTime: 30_000 });
  const { data: me } = useQuery({ queryKey: ["parcel-me", Boolean(uid)], queryFn: fetchMe, enabled: Boolean(uid) });
  useEffect(() => {
    save((d) => ({
      ...d,
      stops: d.stops.map((st) =>
        st.key === "P1"
          ? { ...st, addr: st.addr ?? (hasCoords(defaultPickup) ? defaultPickup : null), name: st.name || me?.name || "", phone: st.phone || me?.phone || "" }
          : st,
      ),
    }));
  }, [defaultPickup?.id, me]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (w: "pickup" | "drop", patch: Partial<ParcelStop>) =>
    save((d) => ({ ...d, stops: d.stops.map((st) => (st.key === keyOf(w) ? { ...st, ...patch } : st)) }));

  const openRow = (w: "pickup" | "drop") => {
    const st = w === "pickup" ? pickupStop : dropStop;
    if (hasCoords(st?.addr)) setDetails(w);
    else setPicker(w);
  };

  const go = (entry: "vehicle" | "multi") => {
    if (!enabled) return toast(c.comingSoon);
    if (entry === "vehicle") {
      if (!complete(pickupStop)) return openRow("pickup");
      if (!complete(dropStop)) return openRow("drop");
    }
    setParcelEntry(entry);
    save((d) => (entry === "multi" ? { ...d, mode: d.mode === "single" ? "multiDrop" : d.mode } : d));
    onStart();
  };
  const ready = complete(pickupStop) && complete(dropStop);
  const multiCount = draft.stops.length;

  return (
    <div>
      <LocationPickerSheet
        open={picker !== null}
        activeId={picker === "pickup" ? (pickupAddr?.id ?? null) : (dropAddr?.id ?? null)}
        title={picker === "pickup" ? s.pickupTitle : s.dropTitle}
        onClose={() => setPicker(null)}
        onSelect={(a) => {
          const w = picker;
          setPicker(null);
          if (!w || !hasCoords(a)) return;
          update(w, { addr: a as ParcelAddr });
          setDetails(w);
        }}
      />
      {details && (
        <DetailsSheet
          kind={details}
          stop={(details === "pickup" ? pickupStop : dropStop)!}
          me={me}
          onChangeAddr={() => { const w = details; setDetails(null); setPicker(w); }}
          onPickRecent={(a) => update(details, { addr: a })}
          onSave={(patch) => { update(details, patch); setDetails(null); }}
          onClose={() => setDetails(null)}
        />
      )}

      <section
        className="bleed-safe-top relative -mx-5 flex min-h-[calc(42vh-10px)] flex-col items-center justify-center overflow-hidden px-6 pb-14 text-center"
        style={{ "--bleed-top-extra": "72px", background: heroImg ? `center/cover no-repeat url("${localSrc(heroImg)}"), ${slab.sky}` : slab.sky } as React.CSSProperties}
      >
        <h1 className={`text-2xl font-extrabold leading-tight ${tone === "light" ? "text-hero-title hero-shadow" : "text-hero-title-dark"}`}>{s.title}</h1>
        <p className={`mt-1.5 text-sm font-semibold ${tone === "light" ? "text-primary-foreground hero-shadow" : "text-hero-title-dark opacity-80"}`}>{s.sub}</p>
        {opensAt && (
          <p className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-full bg-card/80 px-3 py-1 text-xs font-bold text-muted-foreground">
            <Clock className="h-3.5 w-3.5" /> {fill(c.opens, { t: opensAt })}
          </p>
        )}
      </section>

      <div className="relative -mx-5 -mt-8 rounded-t-[28px] bg-background px-5 pt-5">
        {/* Porter-style unified pickup / drop card */}
        <div className="service-glow rounded-[20px] border border-primary/20 p-4 shadow-soft">
          <button type="button" onClick={() => openRow("pickup")} className="flex w-full items-center gap-3 text-left">
            <span className="h-3 w-3 shrink-0 rounded-full bg-primary ring-4 ring-primary/20" />
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{c.pickup}</span>
              <span className="block truncate text-[15px] font-extrabold text-foreground">{pickupAddr ? addrTitle(pickupAddr) : c.wherePickup}</span>
              {pickupAddr && (
                <span className="block truncate text-xs font-semibold text-muted-foreground">{pickupAddr.full_address}</span>
              )}
            </span>
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          </button>
          <div className="my-2 ml-[5px] h-5 border-l-2 border-dashed border-border" />
          <button type="button" onClick={() => openRow("drop")} className="flex w-full items-center gap-3 rounded-[14px] bg-card px-3 py-3 text-left shadow-soft">
            <span className="h-3 w-3 shrink-0 rounded-full bg-destructive ring-4 ring-destructive/20" />
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{c.drop}</span>
              <span className="block truncate text-[15px] font-extrabold text-foreground">{dropAddr ? addrTitle(dropAddr) : c.whereTo}</span>
              {dropAddr && (
                <span className="block truncate text-xs font-semibold text-muted-foreground">{dropAddr.full_address}</span>
              )}
            </span>
            <MapPin className="h-5 w-5 text-primary" />
          </button>
        </div>

        {multiCount > 2 && (
          <p className="mt-2 text-center text-xs font-bold text-muted-foreground">{fill(c.stops, { n: multiCount })}</p>
        )}
        <button
          type="button"
          onClick={() => go(multiCount > 2 ? "multi" : "vehicle")}
          className={`mt-4 flex w-full items-center justify-center gap-1 rounded-[16px] py-4 text-base font-extrabold ${ready ? "bg-primary text-primary-foreground shadow-soft" : "bg-muted text-muted-foreground"}`}
        >
          {c.selectVehicleBtn} <ChevronRight className="h-5 w-5" />
        </button>
        <div className="mt-3 text-center">
          <button type="button" onClick={() => go("multi")} className="text-sm font-extrabold text-primary">{c.addStopLink}</button>
        </div>

        <BrandWatermark />
      </div>
    </div>
  );
}

function DetailsSheet({
  kind, stop, me, onChangeAddr, onPickRecent, onSave, onClose,
}: {
  kind: "pickup" | "drop";
  stop: ParcelStop;
  me?: { name: string; phone: string };
  onChangeAddr: () => void;
  onPickRecent: (a: ParcelAddr) => void;
  onSave: (p: Partial<ParcelStop>) => void;
  onClose: () => void;
}) {
  const c = useParcelCopy();
  useBackHandler(true, onClose);
  const isPick = kind === "pickup";
  const [flat, setFlat] = useState(stop.flat ?? "");
  const [name, setName] = useState(stop.name || (isPick ? me?.name ?? "" : ""));
  const [phone, setPhone] = useState(stop.phone || (isPick ? me?.phone ?? "" : ""));
  const recent = isPick ? [] : readRecentDrops().filter((r) => r.full_address !== stop.addr?.full_address);
  const ok = name.trim().length > 0 && phone10(phone).length === 10;
  const field = "w-full rounded-[14px] border border-border bg-background px-4 py-3 text-base text-foreground outline-none focus:border-primary";
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-foreground/40" onClick={onClose}>
      <div className="mx-auto max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-[24px] bg-card px-4 pb-4 pt-5 safe-bottom" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center">
          <h3 className="flex-1 text-lg font-extrabold text-foreground">{isPick ? c.senderTitle : c.receiverTitle}</h3>
          <button type="button" onClick={onClose} aria-label="Close"><X className="h-5 w-5 text-muted-foreground" /></button>
        </div>
        <div className="mt-3 flex items-center gap-3 rounded-[14px] bg-muted/50 p-3">
          <MapPin className={`h-5 w-5 shrink-0 ${isPick ? "text-primary" : "text-destructive"}`} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-extrabold text-foreground">{addrTitle(stop.addr)}</span>
            <span className="block truncate text-xs text-muted-foreground">{stop.addr?.full_address}</span>
          </span>
          <button type="button" onClick={onChangeAddr} className="shrink-0 text-sm font-extrabold text-primary">{c.change}</button>
        </div>
        {recent.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{c.recentDrops}</p>
            <div className="mt-1.5 flex gap-2 overflow-x-auto">
              {recent.map((r) => (
                <button key={r.id + r.full_address} type="button" onClick={() => onPickRecent(r)} className="max-w-[60%] shrink-0 truncate rounded-full border border-border px-3 py-1.5 text-xs font-bold text-foreground">
                  {addrTitle(r)}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="mt-3 space-y-2.5">
          <input value={flat} maxLength={120} placeholder={c.flat} onChange={(e) => setFlat(e.target.value)} className={field} />
          <input value={name} maxLength={80} placeholder={isPick ? c.senderName : c.receiverName} onChange={(e) => setName(e.target.value)} className={field} />
          <input value={phone} inputMode="numeric" maxLength={10} placeholder={isPick ? c.senderPhone : c.receiverPhone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))} className={field} />
        </div>
        <button
          type="button"
          disabled={!ok}
          onClick={() => onSave({ flat: flat.trim(), name: name.trim(), phone: phone10(phone) })}
          className="mt-4 w-full rounded-[14px] bg-primary py-4 text-base font-extrabold text-primary-foreground disabled:bg-muted disabled:text-muted-foreground"
        >
          {c.save}
        </button>
      </div>
    </div>
  );
}
