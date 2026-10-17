// Full-screen parcel booking steps: (many places) → Choose vehicle → Checkout.
// Fares, coupons, wallet and payment stay server-side (courier.functions).
import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, Ban, Check, ChevronDown, ChevronRight, ChevronUp, Info, Loader2, Pencil, PlusCircle, Tag, Trash2, Wallet, X } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/i18n";
import { supabase } from "@/integrations/supabase/client";
import { getAuthUser } from "@/lib/authUser";
import { ensureSignedIn } from "@/lib/authGate";
import { useBackHandler } from "@/lib/backHandler";
import { hapticImpact } from "@/lib/haptics";
import { fetchServiceState } from "@/lib/serviceHours";
import { courierErrorMessage } from "@/lib/courierError";
import { invalidateWallet, useWalletSummary } from "@/lib/wallet";
import { getPaymentPrefill } from "@/lib/paymentPrefill";
import { payWithRazorpay, toPaymentError } from "@/lib/razorpayCheckout";
import {
  courierConfirmPayment,
  courierCreateOrder,
  courierGetRateLimits,
  courierGuestQuote,
  courierPlanStops,
  courierQuote,
} from "@/lib/courier.functions";
import { LocationPickerSheet } from "@/components/LocationPickerSheet";
import { CouponSheet } from "@/components/CouponSheet";
import { fetchCourierService, fetchCourierTypes, fetchCourierVehicles, type CourierVehicle } from "@/components/courier/courierData";
import { ParcelMap, type MapPin } from "./ParcelMap";
import { fill, rs, useParcelCopy } from "./parcelCopy";
import {
  addrTitle,
  clearDraft,
  emptyDraft,
  hasCoords,
  phone10,
  pushRecentDrop,
  readDraft,
  writeDraft,
  type ParcelDraft,
  type ParcelStop,
} from "./parcelDraft";

type Quote = {
  total_amount?: number;
  base_amount?: number;
  extra_fee?: number;
  platform_fee?: number;
  gst_amount?: number;
  gst_percent?: number;
  discount_amount?: number;
  distance_km?: number;
  stops_fee?: number;
  coupon_ok?: boolean;
};

type Step = "pickup" | "drop" | "multi" | "vehicle" | "goods" | "checkout";

function useSignedIn() {
  const { data } = useQuery({
    queryKey: ["auth-user-id"],
    queryFn: async () => (await getAuthUser()).data.user?.id ?? null,
    staleTime: 30_000,
  });
  return Boolean(data);
}

async function fetchMe() {
  const { data: auth } = await getAuthUser();
  const uid = auth.user?.id;
  if (!uid) return { name: "", phone: "" };
  const { data } = await supabase.from("users").select("full_name, phone").eq("id", uid).maybeSingle();
  return { name: data?.full_name?.trim() ?? "", phone: phone10(data?.phone ?? auth.user?.phone ?? "") };
}

function vehicleIcon(v: CourierVehicle) {
  const i = (v.icon ?? "").trim();
  if (i && [...i].length <= 3) return i;
  return /truck|tempo|van|pickup/i.test(v.name) ? "🚚" : /auto|rick/i.test(v.name) ? "🛺" : "🛵";
}

function fullLine(s: ParcelStop) {
  const f = (s.flat ?? "").trim();
  const a = s.addr?.full_address ?? "";
  return f ? `${f}, ${a}` : a;
}

function stopsComplete(stops: ParcelStop[]) {
  return stops.every((s) => hasCoords(s.addr));
}

/** Shared quote input built from the draft. */
function quoteInput(d: ParcelDraft, city: string, vehicleId: string, typeId: string, coupon?: string | null) {
  const p = d.stops.find((s) => s.type === "pickup")!.addr!;
  const dr = d.stops.find((s) => s.type === "drop")!.addr!;
  return {
    city,
    vehicle_type_id: vehicleId,
    courier_type_id: typeId,
    pickup: { lat: Number(p.latitude), lng: Number(p.longitude) },
    drop: { lat: Number(dr.latitude), lng: Number(dr.longitude) },
    weight_kg: 1,
    ...(coupon ? { coupon_code: coupon } : {}),
  };
}

async function fetchQuote(d: ParcelDraft, city: string, vehicleId: string, typeId: string, signedIn: boolean, coupon?: string | null) {
  const base = quoteInput(d, city, vehicleId, typeId, coupon);
  const multi = d.stops.length > 2;
  if (!signedIn && !multi) return (await courierGuestQuote({ data: base })) as Quote;
  if (!multi) return (await courierQuote({ data: base })) as Quote;
  const order = await courierPlanStops({
    data: {
      stops: d.stops.map((s) => ({ key: s.key, type: s.type, lat: Number(s.addr?.latitude), lng: Number(s.addr?.longitude) })),
    },
  });
  return (await courierQuote({
    data: {
      ...base,
      pickup_count: d.stops.filter((s) => s.type === "pickup").length,
      drop_count: d.stops.filter((s) => s.type === "drop").length,
      route: order.map((o) => ({ lat: o.lat, lng: o.lng })),
    },
  })) as Quote & { _plan?: unknown };
}

export function ParcelFlow({ onBack, onBooked }: { onBack: () => void; onBooked: (orderId: string) => void }) {
  const [draft, setDraftState] = useState<ParcelDraft>(() => readDraft() ?? emptyDraft(null));
  const setDraft = (fn: (d: ParcelDraft) => ParcelDraft) =>
    setDraftState((d) => {
      const n = fn(d);
      writeDraft(n);
      return n;
    });
  const [step, setStep] = useState<Step>(() => {
    if (draft.mode !== "single") return "multi";
    const p = draft.stops.find((s) => s.key === "P1");
    const dr = draft.stops.find((s) => s.type === "drop");
    if (!hasCoords(p?.addr)) return "pickup";
    if (!hasCoords(dr?.addr)) return "drop";
    return "vehicle";
  });
  const back = () => {
    if (step === "checkout") setStep("goods");
    else if (step === "goods") setStep("vehicle");
    else if (step === "vehicle") setStep(draft.mode === "single" ? "drop" : "multi");
    else if (step === "drop") setStep("pickup");
    else onBack();
  };

  if (step === "pickup")
    return <PlaceStep key="pickup" kind="pickup" draft={draft} setDraft={setDraft} onBack={back} onNext={() => setStep("drop")} />;
  if (step === "drop")
    return <PlaceStep key="drop" kind="drop" draft={draft} setDraft={setDraft} onBack={back} onNext={() => setStep("vehicle")} />;
  if (step === "multi")
    return <MultiStopStep draft={draft} setDraft={setDraft} onBack={back} onNext={() => setStep("vehicle")} />;
  if (step === "vehicle")
    return <VehicleStep draft={draft} setDraft={setDraft} onBack={back} onNext={() => setStep("goods")} onEdit={() => setStep(draft.mode === "single" ? "pickup" : "multi")} onAddStop={() => { setDraft((d) => ({ ...d, mode: "multiDrop" })); setStep("multi"); }} />;
  if (step === "goods")
    return <GoodsStep draft={draft} setDraft={setDraft} onBack={back} onNext={() => setStep("checkout")} />;
  return (
    <CheckoutStep
      draft={draft}
      setDraft={setDraft}
      onBack={back}
      onBooked={(id) => {
        draft.stops.filter((s) => s.type === "drop" && s.addr).forEach((s) => pushRecentDrop(s.addr!));
        clearDraft();
        onBooked(id);
      }}
    />
  );
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <button type="button" onClick={onBack} aria-label="Back" className="flex h-10 w-10 items-center justify-center rounded-full bg-card shadow-soft">
        <ArrowLeft className="h-5 w-5 text-foreground" />
      </button>
      <h1 className="text-lg font-extrabold text-foreground">{title}</h1>
    </div>
  );
}

function ContactFields({
  name,
  phone,
  namePh,
  phonePh,
  onChange,
}: {
  name: string;
  phone: string;
  namePh?: string;
  phonePh?: string;
  onChange: (name: string, phone: string) => void;
}) {
  const c = useParcelCopy();
  const input = "w-full rounded-[12px] border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary";
  return (
    <div className="mt-2 grid gap-2">
      <input value={name} maxLength={80} placeholder={namePh ?? c.receiverName} onChange={(e) => onChange(e.target.value, phone)} className={input} />
      <div className="flex gap-2">
        <input
          value={phone}
          inputMode="numeric"
          maxLength={10}
          placeholder={phonePh ?? c.receiverPhone}
          onChange={(e) => onChange(name, e.target.value.replace(/\D/g, "").slice(0, 10))}
          className={input}
        />
      </div>
    </div>
  );
}

/* ---------------- Pickup / Drop step (single action per page) ---------------- */

function PlaceStep({
  kind,
  draft,
  setDraft,
  onBack,
  onNext,
}: {
  kind: "pickup" | "drop";
  draft: ParcelDraft;
  setDraft: (fn: (d: ParcelDraft) => ParcelDraft) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const c = useParcelCopy();
  useBackHandler(true, onBack);
  const signedIn = useSignedIn();
  const stop = kind === "pickup" ? draft.stops.find((s) => s.key === "P1")! : draft.stops.find((s) => s.type === "drop")!;
  const [picking, setPicking] = useState(() => !hasCoords(stop.addr));

  const { data: me } = useQuery({ queryKey: ["parcel-me", signedIn], queryFn: fetchMe, enabled: signedIn });
  useEffect(() => {
    if (kind !== "pickup" || !me) return;
    setDraft((d) => ({
      ...d,
      stops: d.stops.map((s) => (s.key === "P1" ? { ...s, name: s.name || me.name, phone: s.phone || me.phone } : s)),
    }));
  }, [me]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (patch: Partial<ParcelStop>) =>
    setDraft((d) => ({ ...d, stops: d.stops.map((s) => (s.key === stop.key ? { ...s, ...patch } : s)) }));

  const myPhone = me?.phone ?? "";
  const usingMine = myPhone.length === 10 && phone10(stop.phone) === myPhone;
  const valid = hasCoords(stop.addr) && stop.name.trim().length > 0 && phone10(stop.phone).length === 10;
  const isPick = kind === "pickup";
  const Arrow = isPick ? ArrowUp : ArrowDown;
  const field = "w-full rounded-[14px] border border-border bg-muted/50 px-4 text-base text-foreground outline-none focus:border-primary";

  return (
    <main className="min-h-screen w-full bg-card pb-32">
      <div className="relative">
        <ParcelMap
          pins={hasCoords(stop.addr) ? [{ lat: Number(stop.addr.latitude), lng: Number(stop.addr.longitude), kind: stop.type }] : []}
          showMyLocation={!hasCoords(stop.addr)}
          className="h-[44vh] min-h-[260px]"
        />
        <div className="absolute inset-x-0 top-0 px-4 pt-[calc(var(--app-safe-top,0px)+16px)]">
          <button type="button" onClick={onBack} aria-label="Back" className="flex h-11 w-11 items-center justify-center rounded-full bg-card shadow-soft">
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </button>
        </div>
        {hasCoords(stop.addr) && (
          <div className="pointer-events-none absolute left-1/2 top-[34%] -translate-x-1/2 -translate-y-full">
            <div className="relative whitespace-nowrap rounded-[10px] bg-foreground px-3 py-2 text-xs font-bold text-background">
              {isPick ? c.pickedHere : c.droppedHere}
              <span className="absolute left-1/2 top-full -translate-x-1/2 border-x-[6px] border-t-[6px] border-x-transparent border-t-foreground" />
            </div>
          </div>
        )}
        <div className="absolute inset-x-4 bottom-4 flex items-center gap-3 rounded-[18px] bg-card p-3.5 shadow-soft">
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${isPick ? "bg-primary" : "bg-destructive"}`}>
            <Arrow className="h-4 w-4 text-primary-foreground" strokeWidth={3} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-extrabold text-foreground">{stop.addr ? stop.addr.area || stop.addr.label || addrTitle(stop.addr) : c.chooseAddr}</span>
            {stop.addr && <span className="block truncate text-sm text-muted-foreground">{stop.addr.full_address}</span>}
          </span>
          <button type="button" onClick={() => setPicking(true)} className="shrink-0 rounded-[10px] border-2 border-primary px-3 py-1.5 text-sm font-extrabold text-primary">
            {c.changePlace}
          </button>
        </div>
      </div>

      <div className="relative -mt-2 mx-auto w-full max-w-md space-y-3 rounded-t-[24px] bg-card px-4 pt-5">
        <input value={stop.flat ?? ""} maxLength={120} placeholder={c.flat} onChange={(e) => update({ flat: e.target.value })} className={`${field} py-4`} />
        <label className={`${field} block py-2.5`}>
          <span className="block text-xs text-muted-foreground">{isPick ? c.senderName : c.receiverName}</span>
          <input value={stop.name} maxLength={80} onChange={(e) => update({ name: e.target.value })} className="w-full bg-transparent text-base outline-none" />
        </label>
        <label className={`${field} block py-2.5`}>
          <span className="block text-xs text-muted-foreground">{isPick ? c.senderPhone : c.receiverPhone}</span>
          <input
            value={stop.phone}
            inputMode="numeric"
            maxLength={10}
            onChange={(e) => update({ phone: e.target.value.replace(/\D/g, "").slice(0, 10) })}
            className="w-full bg-transparent text-base outline-none"
          />
        </label>
        {myPhone.length === 10 && (
          <button
            type="button"
            onClick={() => update(usingMine ? { phone: "" } : { phone: myPhone, name: stop.name || (isPick ? me?.name ?? "" : "") })}
            className="flex items-center gap-3 py-1 text-left text-sm font-bold text-foreground"
          >
            <span className={`flex h-5 w-5 items-center justify-center rounded-[5px] border-2 ${usingMine ? "border-primary bg-primary" : "border-muted-foreground"}`}>
              {usingMine && <Check className="h-3.5 w-3.5 text-primary-foreground" strokeWidth={3} />}
            </span>
            {fill(c.useMine, { n: myPhone })}
          </button>
        )}
      </div>
      <BottomBar>
        <button
          type="button"
          onClick={() => (valid ? onNext() : !hasCoords(stop.addr) ? setPicking(true) : toast(isPick ? c.needSender : c.needReceiver))}
          className="flex flex-1 items-center justify-center rounded-[14px] bg-primary py-4 text-base font-extrabold text-primary-foreground"
        >
          {valid || isPick ? c.confirmProceed : c.enterContact}
        </button>
      </BottomBar>
      <LocationPickerSheet
        open={picking}
        activeId={stop.addr?.id ?? null}
        onClose={() => {
          setPicking(false);
          if (!hasCoords(stop.addr)) onBack();
        }}
        onSelect={(a) => {
          if (hasCoords(a)) update({ addr: a });
          setPicking(false);
        }}
      />
    </main>
  );
}

/* ---------------- Send to many places ---------------- */

function MultiStopStep({
  draft,
  setDraft,
  onBack,
  onNext,
}: {
  draft: ParcelDraft;
  setDraft: (fn: (d: ParcelDraft) => ParcelDraft) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const c = useParcelCopy();
  useBackHandler(true, onBack);
  const [picking, setPicking] = useState<string | null>(null);
  const many = draft.mode === "multiPickup" ? "pickup" : "drop";

  const setMode = (mode: "multiDrop" | "multiPickup") =>
    setDraft((d) => {
      const pickups = d.stops.filter((s) => s.type === "pickup");
      const drops = d.stops.filter((s) => s.type === "drop");
      const stops = mode === "multiDrop" ? [pickups[0], ...drops] : [...pickups, drops[0]];
      return { ...d, mode, stops };
    });
  const add = () =>
    setDraft((d) => {
      const n = d.stops.filter((s) => s.type === many).length + 1;
      const s: ParcelStop = { key: `${many === "pickup" ? "P" : "D"}${n}`, type: many, addr: null, name: "", phone: "" };
      const stops = many === "pickup" ? [...d.stops.filter((x) => x.type === "pickup"), s, ...d.stops.filter((x) => x.type === "drop")] : [...d.stops, s];
      return { ...d, stops };
    });
  const update = (key: string, patch: Partial<ParcelStop>) =>
    setDraft((d) => ({ ...d, stops: d.stops.map((s) => (s.key === key ? { ...s, ...patch } : s)) }));
  const remove = (key: string) => setDraft((d) => ({ ...d, stops: d.stops.filter((s) => s.key !== key) }));

  const valid =
    draft.stops.length >= 3 &&
    stopsComplete(draft.stops) &&
    draft.stops.every((s) => (s.key === "P1" && s.type === "pickup") || (s.name.trim() && phone10(s.phone).length === 10));

  return (
    <main className="min-h-screen w-full bg-surface-soft pb-32">
      <div className="mx-auto w-full max-w-md px-4 pt-[calc(var(--app-safe-top,0px)+20px)]">
        <Header title={c.manyTitle} onBack={onBack} />
        <div className="mt-4 grid grid-cols-2 gap-2">
          {(["multiDrop", "multiPickup"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-[14px] border-2 px-3 py-3 text-xs font-extrabold ${draft.mode === m ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-foreground"}`}
            >
              {m === "multiDrop" ? c.manyDrops : c.manyPickups}
            </button>
          ))}
        </div>
        <div className="mt-4 space-y-3">
          {draft.stops.map((s) => (
            <section key={s.key} className="rounded-[16px] bg-card p-4 shadow-soft">
              <div className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${s.type === "pickup" ? "bg-primary" : "bg-destructive"}`} />
                <span className="text-xs font-extrabold uppercase text-muted-foreground">
                  {s.type === "pickup" ? c.pickup : c.drop} {s.key.slice(1)}
                </span>
                <span className="flex-1" />
                {s.type === many && draft.stops.filter((x) => x.type === many).length > 1 && (
                  <button type="button" onClick={() => remove(s.key)} aria-label={c.remove} className="text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
              <button type="button" onClick={() => setPicking(s.key)} className="mt-2 flex w-full items-center gap-2 text-left">
                <span className={`min-w-0 flex-1 truncate text-sm font-bold ${s.addr ? "text-foreground" : "text-primary"}`}>
                  {s.addr ? addrTitle(s.addr) : c.chooseAddr}
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
              {!(s.key === "P1" && s.type === "pickup") && (
                <ContactFields name={s.name} phone={s.phone} onChange={(name, phone) => update(s.key, { name, phone })} />
              )}
            </section>
          ))}
        </div>
        <button type="button" onClick={add} className="mt-3 text-sm font-extrabold text-primary">
          {many === "drop" ? c.addDrop : c.addPickupStop}
        </button>
      </div>
      <BottomBar>
        <button
          type="button"
          onClick={() => (valid ? onNext() : toast(c.stopsNeed))}
          className="flex flex-1 items-center justify-center rounded-[14px] bg-primary py-3.5 text-base font-extrabold text-primary-foreground disabled:opacity-60"
        >
          {c.continue}
        </button>
      </BottomBar>
      <LocationPickerSheet
        open={picking != null}
        activeId={null}
        onClose={() => setPicking(null)}
        onSelect={(a) => {
          if (picking && hasCoords(a)) update(picking, { addr: a });
          setPicking(null);
        }}
      />
    </main>
  );
}

function BottomBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-10 bg-card shadow-[0_-4px_16px_rgba(0,0,0,0.06)] safe-bottom">
      <div className="mx-auto flex w-full max-w-md items-center gap-4 px-4 py-3">{children}</div>
    </div>
  );
}

function useCity(d: ParcelDraft) {
  const { data: svc } = useQuery({ queryKey: ["courier_service"], queryFn: () => fetchCourierService(), staleTime: 5 * 60_000 });
  const p = d.stops.find((s) => s.type === "pickup")?.addr;
  return (p?.city || "").trim() || svc?.city || "Latur";
}

function pinsOf(d: ParcelDraft): MapPin[] {
  return d.stops.filter((s) => hasCoords(s.addr)).map((s) => ({ lat: Number(s.addr!.latitude), lng: Number(s.addr!.longitude), kind: s.type }));
}

/* ---------------- Choose vehicle ---------------- */

function VehicleStep({
  draft,
  setDraft,
  onBack,
  onNext,
  onEdit,
  onAddStop,
}: {
  draft: ParcelDraft;
  setDraft: (fn: (d: ParcelDraft) => ParcelDraft) => void;
  onBack: () => void;
  onNext: () => void;
  onEdit: () => void;
  onAddStop: () => void;
}) {
  const c = useParcelCopy();
  const t = useT();
  useBackHandler(true, onBack);
  const signedIn = useSignedIn();
  const city = useCity(draft);
  const multi = draft.stops.length > 2;
  const ready = stopsComplete(draft.stops);
  const [info, setInfo] = useState<CourierVehicle | null>(null);
  const { data: vehicles = [] } = useQuery({ queryKey: ["courier_vehicles"], queryFn: fetchCourierVehicles, staleTime: 5 * 60_000 });
  const typeQs = useQueries({
    queries: vehicles.map((v) => ({ queryKey: ["courier_types", v.id], queryFn: () => fetchCourierTypes(v.id), staleTime: 5 * 60_000 })),
  });
  const typesFor = (vid: string) => typeQs[vehicles.findIndex((v) => v.id === vid)]?.data ?? [];

  useEffect(() => {
    if (!draft.vehicleId && vehicles[0]) setDraft((d) => ({ ...d, vehicleId: vehicles[0].id }));
  }, [vehicles, draft.vehicleId]); // eslint-disable-line react-hooks/exhaustive-deps
  const types = draft.vehicleId ? typesFor(draft.vehicleId) : [];
  useEffect(() => {
    if (types.length && !types.some((x) => x.id === draft.typeId)) setDraft((d) => ({ ...d, typeId: types[0].id }));
  }, [types, draft.typeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const typeFor = (vid: string) => {
    const list = typesFor(vid);
    return list.find((x) => x.id === draft.typeId)?.id ?? list[0]?.id ?? null;
  };
  const stopsKey = draft.stops.map((s) => `${s.key}:${s.addr?.latitude},${s.addr?.longitude}`).join("|");
  const quotes = useQueries({
    queries: vehicles.map((v) => {
      const tid = typeFor(v.id);
      return {
        queryKey: ["parcel-quote", v.id, tid, city, stopsKey, signedIn],
        queryFn: () => fetchQuote(draft, city, v.id, tid!, signedIn),
        enabled: ready && Boolean(tid) && (!multi || signedIn),
        staleTime: 60_000,
        retry: false,
      };
    }),
  });

  const { data: limits } = useQuery({
    queryKey: ["courier_rate_limits", city, draft.vehicleId],
    queryFn: () => courierGetRateLimits({ data: { city, vehicle_type_id: draft.vehicleId! } }),
    enabled: multi && signedIn && Boolean(draft.vehicleId),
    staleTime: 5 * 60_000,
  });
  useEffect(() => {
    if (multi && !signedIn) void ensureSignedIn();
  }, [multi, signedIn]);

  const idx = vehicles.findIndex((v) => v.id === draft.vehicleId);
  const selV = idx >= 0 ? vehicles[idx] : null;
  const sel = idx >= 0 ? quotes[idx] : null;
  const price = sel?.data?.total_amount;
  const km = sel?.data?.distance_km ?? quotes.find((q) => q.data)?.data?.distance_km;
  const pickups = draft.stops.filter((s) => s.type === "pickup").length;
  const drops = draft.stops.length - pickups;
  const over = limits ? pickups > limits.max_pickups || drops > limits.max_drops : false;

  const next = () => {
    if (!ready) return toast(c.needDrop);
    if (over && limits) return toast(fill(c.overLimit, { p: limits.max_pickups, d: limits.max_drops }));
    if (price == null) return;
    onNext();
  };
  const swap = () =>
    setDraft((d) => {
      if (d.stops.length !== 2) return d;
      const [a, b] = d.stops;
      return { ...d, stops: [{ ...a, addr: b.addr, name: b.name, phone: b.phone, flat: b.flat }, { ...b, addr: a.addr, name: a.name, phone: a.phone, flat: a.flat }] };
    });

  const priceOf = (i: number) => {
    const q = quotes[i];
    if (q?.data?.total_amount != null) return { now: Number(q.data.total_amount), off: Number(q.data.discount_amount ?? 0) };
    return null;
  };

  return (
    <main className="min-h-screen w-full bg-surface-soft pb-32">
      <div className="mx-auto w-full max-w-md px-4 pt-[calc(var(--app-safe-top,0px)+16px)]">
        <div className="flex items-center gap-4">
          <button type="button" onClick={onBack} aria-label="Back" className="p-1">
            <ArrowLeft className="h-6 w-6 text-foreground" />
          </button>
          <h1 className="text-xl font-extrabold text-foreground">{c.selectVehicle}</h1>
          {km != null && <span className="ml-auto rounded-full bg-card px-3 py-1 text-xs font-extrabold text-foreground shadow-soft">{fill(c.km, { n: rs(Number(km)) })}</span>}
        </div>

        <div className="mt-4 rounded-[18px] bg-card p-4 shadow-soft">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              {draft.stops.map((s, i) => (
                <div key={s.key} className="relative flex gap-3 pb-3 last:pb-0">
                  {i < draft.stops.length - 1 && <span className="absolute left-[11px] top-7 h-[calc(100%-20px)] border-l-2 border-dashed border-border" />}
                  <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${s.type === "pickup" ? "bg-primary" : "bg-destructive"}`}>
                    {s.type === "pickup" ? <ArrowUp className="h-3.5 w-3.5 text-primary-foreground" strokeWidth={3} /> : <ArrowDown className="h-3.5 w-3.5 text-primary-foreground" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold text-foreground">{[s.name, s.phone].filter(Boolean).join(" · ") || addrTitle(s.addr)}</span>
                    <span className="block truncate text-sm text-muted-foreground">{fullLine(s)}</span>
                  </span>
                </div>
              ))}
            </div>
            {draft.stops.length === 2 && (
              <button type="button" onClick={swap} aria-label="Swap" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
                <ArrowUpDown className="h-4 w-4 text-foreground" />
              </button>
            )}
          </div>
          <div className="mt-3 grid grid-cols-2 divide-x divide-border border-t border-border pt-3">
            <button type="button" onClick={onAddStop} className="flex items-center justify-center gap-1.5 text-sm font-extrabold text-primary">
              <PlusCircle className="h-4 w-4" />{c.addStop}
            </button>
            <button type="button" onClick={onEdit} className="flex items-center justify-center gap-1.5 text-sm font-extrabold text-primary">
              <Pencil className="h-4 w-4" />{c.editLocations}
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto mt-4 w-full max-w-md rounded-t-[24px] bg-card px-4 pb-4 pt-4">
        <div className="space-y-1">
          {vehicles.map((v, i) => {
            const q = quotes[i];
            const p = priceOf(i);
            const on = v.id === draft.vehicleId;
            const meta = [v.max_weight_kg != null ? `${Number(v.max_weight_kg)} kg` : null].filter(Boolean).join(" · ");
            const choose = () => {
              void hapticImpact("light");
              setDraft((d) => ({ ...d, vehicleId: v.id }));
            };
            if (on)
              return (
                <div key={v.id} role="button" onClick={choose} className="relative rounded-[18px] border-2 border-primary bg-gradient-to-br from-primary/15 to-card p-4">
                  {p && p.off > 0 && (
                    <span className="absolute right-3 top-3 flex items-center gap-1 rounded-[8px] bg-primary px-2 py-1 text-xs font-extrabold text-primary-foreground">
                      <Tag className="h-3 w-3" />₹{rs(p.off)} OFF
                    </span>
                  )}
                  <div className="flex h-24 items-center justify-center text-6xl" aria-hidden>{vehicleIcon(v)}</div>
                  <div className="mt-2 flex items-end justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-xl font-extrabold text-foreground">{v.name}</span>
                        <button type="button" onClick={(e) => { e.stopPropagation(); setInfo(v); }} aria-label="Info">
                          <Info className="h-5 w-5 text-muted-foreground" />
                        </button>
                      </div>
                      {meta && <span className="block text-sm text-muted-foreground">{meta}</span>}
                    </div>
                    <div className="text-right">
                      <span className="block text-xl font-extrabold text-foreground">
                        {p ? `₹${rs(p.now)}` : q?.isFetching ? <Loader2 className="h-5 w-5 animate-spin" /> : "—"}
                      </span>
                      {p && p.off > 0 && <span className="block text-sm text-muted-foreground line-through">₹{rs(p.now + p.off)}</span>}
                    </div>
                  </div>
                </div>
              );
            return (
              <button key={v.id} type="button" onClick={choose} className="flex w-full items-center gap-4 rounded-[14px] px-2 py-4 text-left">
                <span className="flex h-14 w-16 shrink-0 items-center justify-center text-4xl" aria-hidden>{vehicleIcon(v)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-lg font-extrabold text-foreground">{v.name}</span>
                  {meta && <span className="block text-sm text-muted-foreground">{meta}</span>}
                </span>
                <span className="text-right">
                  <span className="block text-lg font-extrabold text-foreground">
                    {p ? `₹${rs(p.now)}` : q?.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "—"}
                  </span>
                  {p && p.off > 0 && <span className="block text-xs text-muted-foreground line-through">₹{rs(p.now + p.off)}</span>}
                </span>
              </button>
            );
          })}
          {sel?.error && <p className="text-xs font-semibold text-destructive">{courierErrorMessage(sel.error, c.priceError)}</p>}
        </div>
      </div>

      <BottomBar>
        <button
          type="button"
          onClick={next}
          disabled={price == null}
          className="flex flex-1 items-center justify-center gap-2 rounded-[14px] bg-primary py-4 text-base font-extrabold text-primary-foreground disabled:opacity-60"
        >
          {price != null && selV ? fill(c.proceedWith, { v: selV.name }) : t("common.loading")}
        </button>
      </BottomBar>

      {info && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-foreground/40" onClick={() => setInfo(null)}>
          <div className="mx-auto mb-3 flex w-full max-w-md justify-end px-4">
            <button type="button" aria-label="Close" className="flex h-12 w-12 items-center justify-center rounded-full bg-card shadow-soft">
              <X className="h-5 w-5 text-foreground" />
            </button>
          </div>
          <div className="mx-auto w-full max-w-md rounded-t-[24px] bg-card px-4 pb-4 pt-4 safe-bottom" onClick={(e) => e.stopPropagation()}>
            <div className="flex h-40 items-center justify-center rounded-[16px] bg-primary/10 text-7xl" aria-hidden>{vehicleIcon(info)}</div>
            <h3 className="mt-4 text-center text-2xl font-extrabold text-foreground">{info.name}</h3>
            {info.max_weight_kg != null && <p className="mt-1 text-center text-base font-bold text-foreground">{fill(c.upTo, { n: Number(info.max_weight_kg) })}</p>}
            <p className="mt-2 text-center text-sm text-muted-foreground">{c.doorstep}</p>
            {!!info.inclusions?.length && (
              <div className="mt-4">
                <p className="text-xs font-extrabold uppercase tracking-wide text-primary">{c.included}</p>
                {info.inclusions.map((it) => (
                  <p key={it} className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{it}</p>
                ))}
              </div>
            )}
            {!!info.exclusions?.length && (
              <div className="mt-3">
                <p className="text-xs font-extrabold uppercase tracking-wide text-destructive">{c.notIncluded}</p>
                {info.exclusions.map((it) => (
                  <p key={it} className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground"><X className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />{it}</p>
                ))}
              </div>
            )}
            <p className="mt-4 text-center text-sm text-muted-foreground">{fill(c.fleet, { v: info.name })}</p>
            <button type="button" onClick={() => setInfo(null)} className="mt-4 w-full rounded-[14px] bg-primary py-4 text-base font-extrabold text-primary-foreground">
              {c.done}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

/* ---------------- Goods type ---------------- */

const RESTRICTED = [
  "Pornographic Materials", "Dry Ice", "Human Body Parts", "Explosives", "Fire Arms", "Flammables", "Livestock", "Pets & Animals",
  "Dangerous Goods", "Hazardous Goods", "Illegal Goods", "Radioactive Materials", "Precious Jewelleries", "Currencies & Coins",
  "Stones and Gems", "Gambling Devices", "Lottery Tickets", "Fire Extinguishers", "Cigarettes & Alcohols", "Narcotics and Illegal Drugs",
];

function GoodsStep({
  draft,
  setDraft,
  onBack,
  onNext,
}: {
  draft: ParcelDraft;
  setDraft: (fn: (d: ParcelDraft) => ParcelDraft) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const c = useParcelCopy();
  useBackHandler(true, onBack);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(draft.typeId);
  const { data: types = [], isLoading } = useQuery({
    queryKey: ["courier_types", draft.vehicleId],
    queryFn: () => fetchCourierTypes(draft.vehicleId!),
    enabled: Boolean(draft.vehicleId),
    staleTime: 5 * 60_000,
  });
  return (
    <main className="min-h-screen w-full bg-surface-soft pb-32">
      <div className="mx-auto w-full max-w-md px-4 pt-[calc(var(--app-safe-top,0px)+16px)]">
        <div className="flex items-center gap-4">
          <button type="button" onClick={onBack} aria-label="Back" className="p-1">
            <ArrowLeft className="h-6 w-6 text-foreground" />
          </button>
          <h1 className="text-xl font-extrabold text-foreground">{c.reviewBooking}</h1>
        </div>
        <h2 className="mt-6 text-lg font-extrabold text-foreground">{c.goodsType}</h2>
        <div className="mt-3 rounded-[18px] bg-warning/20 p-4">
          <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 text-left">
            <Ban className="h-7 w-7 shrink-0 text-destructive" />
            <span className="min-w-0 flex-1">
              <span className="block text-base font-extrabold text-foreground">{c.restricted}</span>
              <span className="block text-sm text-muted-foreground">{c.restrictedSub}</span>
            </span>
            <span className="flex items-center gap-1 text-sm font-extrabold text-primary">
              {open ? c.hide : c.seeAll}
              {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </span>
          </button>
          {open && (
            <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-dashed border-muted-foreground/40 pt-3 text-sm text-muted-foreground">
              {RESTRICTED.map((r) => <li key={r}>• {r}</li>)}
            </ul>
          )}
        </div>
        <div className="mt-3 space-y-2.5">
          {isLoading && <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />}
          {types.map((ty) => {
            const on = ty.id === picked;
            return (
              <button
                key={ty.id}
                type="button"
                onClick={() => setPicked(ty.id)}
                className={`flex w-full items-center gap-3 rounded-[16px] border-2 bg-card px-4 py-4 text-left ${on ? "border-primary bg-primary/10" : "border-border"}`}
              >
                <span className="w-6 text-center text-xl" aria-hidden>{ty.icon && [...ty.icon].length <= 3 ? ty.icon : "📦"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base text-foreground">{ty.name}</span>
                  {ty.instructions && <span className="block text-xs text-muted-foreground">{ty.instructions}</span>}
                </span>
                {on && <Check className="h-5 w-5 text-primary" />}
              </button>
            );
          })}
        </div>
      </div>
      <BottomBar>
        <button
          type="button"
          disabled={!picked}
          onClick={() => {
            if (!picked) return toast(c.chooseGoods);
            setDraft((d) => ({ ...d, typeId: picked }));
            onNext();
          }}
          className="flex flex-1 items-center justify-center rounded-[14px] bg-primary py-4 text-base font-extrabold text-primary-foreground disabled:bg-muted disabled:text-muted-foreground"
        >
          {c.confirm}
        </button>
      </BottomBar>
    </main>
  );
}

/* ---------------- Checkout ---------------- */

function CheckoutStep({
  draft,
  setDraft,
  onBack,
  onBooked,
}: {
  draft: ParcelDraft;
  setDraft: (fn: (d: ParcelDraft) => ParcelDraft) => void;
  onBack: () => void;
  onBooked: (id: string) => void;
}) {
  const c = useParcelCopy();
  const t = useT();
  const qc = useQueryClient();
  const [couponOpen, setCouponOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(true);
  const [paying, setPaying] = useState(false);
  useBackHandler(!couponOpen, onBack);
  const signedIn = useSignedIn();
  const city = useCity(draft);
  const multi = draft.stops.length > 2;
  const { data: me } = useQuery({ queryKey: ["parcel-me", signedIn], queryFn: fetchMe, enabled: signedIn });
  const { data: wallet } = useWalletSummary();
  const { data: vehicles = [] } = useQuery({ queryKey: ["courier_vehicles"], queryFn: fetchCourierVehicles, staleTime: 5 * 60_000 });
  const { data: types = [] } = useQuery({
    queryKey: ["courier_types", draft.vehicleId],
    queryFn: () => fetchCourierTypes(draft.vehicleId),
    enabled: Boolean(draft.vehicleId),
  });
  const vehicle = vehicles.find((v) => v.id === draft.vehicleId);
  const ptype = types.find((x) => x.id === draft.typeId);

  const stopsKey = draft.stops.map((s) => `${s.key}:${s.addr?.latitude},${s.addr?.longitude}`).join("|");
  const { data: quote, isFetching, error } = useQuery({
    queryKey: ["parcel-quote-checkout", draft.vehicleId, draft.typeId, city, stopsKey, signedIn, draft.coupon],
    queryFn: () => fetchQuote(draft, city, draft.vehicleId!, draft.typeId!, signedIn, draft.coupon),
    enabled: Boolean(draft.vehicleId && draft.typeId),
    placeholderData: keepPreviousData,
    retry: false,
  });

  // A coupon the backend refuses is dropped with a message.
  useEffect(() => {
    if (error && draft.coupon) {
      toast.error(courierErrorMessage(error, c.priceError));
      setDraft((d) => ({ ...d, coupon: null }));
    }
  }, [error]); // eslint-disable-line react-hooks/exhaustive-deps

  const fare = Number(quote?.total_amount ?? 0);
  const balance = wallet?.balance ?? 0;
  const walletUse = draft.useWallet ? Math.min(balance, fare) : 0;
  const toPay = Math.max(0, Math.round((fare - walletUse) * 100) / 100);
  const walletOnly = walletUse > 0 && toPay <= 0;

  const pay = async () => {
    if (paying || !quote) return;
    if (!(await ensureSignedIn())) return;
    if (!confirmed) return toast(c.confirmNeed);
    setPaying(true);
    void hapticImpact("medium");
    try {
      const st = await fetchServiceState("courier");
      if (st && !st.can_order) throw new Error("SERVICE_CLOSED");
      const profile = me ?? (await fetchMe());
      const p1 = draft.stops.find((s) => s.type === "pickup")!;
      const d1 = draft.stops.find((s) => s.type === "drop")!;
      const contact = (s: ParcelStop) =>
        s.key === "P1" && s.type === "pickup"
          ? { name: s.name.trim() || profile.name || "Customer", phone: phone10(s.phone).length === 10 ? phone10(s.phone) : profile.phone }
          : { name: s.name.trim(), phone: phone10(s.phone) };
      const pc = contact(p1);
      const dc = contact(d1);
      let stops: Record<string, unknown>[] | undefined;
      let parcels: Record<string, unknown>[] | undefined;
      if (multi) {
        const order = await courierPlanStops({
          data: { stops: draft.stops.map((s) => ({ key: s.key, type: s.type, lat: Number(s.addr?.latitude), lng: Number(s.addr?.longitude) })) },
        });
        stops = order.map((o) => {
          const s = draft.stops.find((x) => x.key === o.key)!;
          const ct = contact(s);
          return { key: s.key, type: s.type, lat: Number(s.addr?.latitude), lng: Number(s.addr?.longitude), address: fullLine(s), contact_name: ct.name, contact_phone: ct.phone };
        });
        const pickups = draft.stops.filter((s) => s.type === "pickup");
        parcels =
          pickups.length === 1
            ? draft.stops.filter((s) => s.type === "drop").map((s) => ({ pickup_key: "P1", drop_key: s.key, description: draft.note.trim() || null }))
            : pickups.map((s) => ({ pickup_key: s.key, drop_key: d1.key, description: draft.note.trim() || null }));
      }
      const order = await courierCreateOrder({
        data: {
          ...quoteInput(draft, city, draft.vehicleId!, draft.typeId!, draft.coupon),
          pickup_address: fullLine(p1),
          pickup_contact_name: pc.name,
          pickup_contact_phone: pc.phone,
          drop_address: fullLine(d1),
          drop_contact_name: dc.name,
          drop_contact_phone: dc.phone,
          package_description: draft.note.trim() || undefined,
          prohibited_items_confirmed: true as const,
          use_wallet: draft.useWallet && balance > 0,
          ...(multi
            ? {
                pickup_count: draft.stops.filter((s) => s.type === "pickup").length,
                drop_count: draft.stops.filter((s) => s.type === "drop").length,
                stops,
                parcels,
              }
            : {}),
        },
      });
      invalidateWallet(qc);
      if (order.free || order.amount <= 0) return onBooked(order.order_id);
      const prefill = await getPaymentPrefill(pc.phone);
      const result = await payWithRazorpay({
        key: order.key_id,
        amount: order.amount,
        currency: "INR",
        order_id: order.razorpay_order_id,
        name: "Badiyos",
        description: "Parcel delivery",
        contact: prefill.contact,
        email: prefill.email,
        customerName: prefill.name,
      });
      await courierConfirmPayment({
        data: { order_id: order.order_id, razorpay_payment_id: result.razorpay_payment_id, razorpay_order_id: result.razorpay_order_id },
      });
      onBooked(order.order_id);
    } catch (e) {
      invalidateWallet(qc);
      const pe = toPaymentError(e);
      if (pe.category === "cancelled") toast(t("payment.cancelledToast"));
      else toast.error(courierErrorMessage(e, c.priceError));
    } finally {
      setPaying(false);
    }
  };

  const row = (label: string, value: string, accent = false) => (
    <div className="mt-2 flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={accent ? "font-bold text-primary" : "text-foreground"}>{value}</span>
    </div>
  );
  const receiver = draft.stops.find((s) => s.type === "drop");

  const summary = useMemo(
    () => [
      vehicle && [c.vehicle, `${vehicleIcon(vehicle)} ${vehicle.name}`],
      quote?.distance_km != null && [c.distance, fill(c.km, { n: rs(Number(quote.distance_km)) })],
      ptype && [c.parcelType, ptype.name],
      !multi && receiver && [c.receiver, `${receiver.name} · ${receiver.phone}`],
      multi && [c.route, fill(c.stops, { n: draft.stops.length })],
    ].filter(Boolean) as [string, string][],
    [vehicle, quote, ptype, receiver, multi, draft.stops.length, c],
  );

  return (
    <main className="min-h-screen w-full bg-surface-soft pb-32">
      <div className="mx-auto w-full max-w-md px-4 pt-[calc(var(--app-safe-top,0px)+20px)]">
        <Header title={c.checkout} onBack={onBack} />

        <section className="mt-4 rounded-[16px] bg-card p-4 shadow-soft">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{c.route}</p>
          <div className="mt-2 space-y-1.5">
            {draft.stops.map((s) => (
              <p key={s.key} className="flex items-start gap-2 text-sm">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${s.type === "pickup" ? "bg-primary" : "bg-destructive"}`} />
                <span className="min-w-0">
                  <span className="block truncate font-bold text-foreground">{addrTitle(s.addr)}</span>
                  <span className="block truncate text-xs text-muted-foreground">{s.addr?.full_address}</span>
                </span>
              </p>
            ))}
          </div>
          <div className="my-3 h-px bg-border" />
          {summary.map(([k, v]) => row(k, v))}
        </section>

        <section className="mt-3 overflow-hidden rounded-[16px] bg-card shadow-soft">
          {draft.coupon && quote ? (
            <div className="flex items-center gap-3 px-4 py-3.5">
              <Tag className="h-5 w-5 shrink-0 text-primary" />
              <p className="min-w-0 flex-1 truncate text-sm font-extrabold text-foreground">
                {draft.coupon} · −₹{rs(Number(quote.discount_amount ?? 0))}
              </p>
              <button type="button" onClick={() => setDraft((d) => ({ ...d, coupon: null }))} className="flex items-center gap-1 text-sm font-extrabold text-destructive">
                <X className="h-4 w-4" />
                {c.removeCoupon}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={async () => {
                if (await ensureSignedIn()) setCouponOpen(true);
              }}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
            >
              <Tag className="h-5 w-5 shrink-0 text-primary" />
              <span className="flex-1 text-sm font-extrabold text-foreground">{c.applyCoupon}</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
          {balance > 0 && (
            <>
              <div className="mx-4 border-t border-border" />
              <div className="flex items-center gap-3 px-4 py-3.5">
                <Wallet className="h-5 w-5 shrink-0 text-primary" />
                <span className="flex-1 text-sm font-extrabold text-foreground">
                  {c.wallet} (₹{rs(balance)})
                </span>
                <Switch checked={draft.useWallet} aria-label={c.wallet} onCheckedChange={(v) => setDraft((d) => ({ ...d, useWallet: v }))} />
              </div>
            </>
          )}
        </section>

        <section className="mt-3 rounded-[16px] bg-card p-4 shadow-soft">
          <label htmlFor="parcel-note" className="text-sm font-extrabold text-foreground">{c.noteRider}</label>
          <textarea
            id="parcel-note"
            value={draft.note}
            maxLength={300}
            rows={2}
            placeholder={c.notePh}
            onChange={(e) => {
              const note = e.target.value.slice(0, 300);
              setDraft((d) => ({ ...d, note }));
            }}
            className="mt-2 w-full resize-none rounded-[12px] border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          />
          <p className="text-right text-[11px] text-muted-foreground">{draft.note.length}/300</p>
        </section>

        <section className="mt-3 rounded-[16px] bg-card p-4 shadow-soft">
          <p className="text-sm font-extrabold text-foreground">{c.bill}</p>
          {quote ? (
            <>
              {row(c.fare, `₹${rs(Number(quote.base_amount ?? 0))}`)}
              {Number(quote.extra_fee ?? 0) > 0 && row(c.extra, `₹${rs(Number(quote.extra_fee))}`)}
              {Number(quote.stops_fee ?? 0) > 0 && row(c.stopsFee, `₹${rs(Number(quote.stops_fee))}`)}
              {Number(quote.platform_fee ?? 0) > 0 && row(c.platform, `₹${rs(Number(quote.platform_fee))}`)}
              {Number(quote.gst_amount ?? 0) > 0 &&
                row(`${c.gst}${quote.gst_percent ? ` (${Number(quote.gst_percent)}%)` : ""}`, `₹${rs(Number(quote.gst_amount))}`)}
              {Number(quote.discount_amount ?? 0) > 0 && row(c.coupon, `−₹${rs(Number(quote.discount_amount))}`, true)}
              {walletUse > 0 && row(c.walletLine, `−₹${rs(walletUse)}`, true)}
              <div className="my-3 h-px bg-border" />
              <div className="flex items-center justify-between text-base font-extrabold text-foreground">
                <span>{c.total}</span>
                <span>₹{rs(toPay)}</span>
              </div>
            </>
          ) : (
            <div className="mt-2 h-16 animate-pulse rounded-[10px] bg-muted" />
          )}
        </section>

        <label className="mt-3 flex items-start gap-2 px-1 text-xs text-muted-foreground">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 accent-primary" />
          {c.confirmItems}
        </label>
      </div>
      <BottomBar>
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground">{c.total}</span>
          <span className="text-lg font-extrabold text-foreground">₹{rs(toPay)}</span>
        </div>
        <button
          type="button"
          onClick={() => void pay()}
          disabled={paying || !quote || isFetching}
          className="flex flex-1 items-center justify-center gap-2 rounded-[14px] bg-primary py-3.5 text-base font-extrabold text-primary-foreground active:scale-[0.99] disabled:opacity-60"
        >
          {paying && <Loader2 className="h-4 w-4 animate-spin" />}
          {walletOnly ? c.payWallet : fill(c.pay, { n: rs(toPay) })}
        </button>
      </BottomBar>
      {couponOpen && (
        <CouponSheet
          baseAmount={Number(quote?.base_amount ?? fare)}
          appliedCode={draft.coupon}
          onApplied={(cp) => {
            setDraft((d) => ({ ...d, coupon: cp.code }));
            setCouponOpen(false);
          }}
          onClose={() => setCouponOpen(false)}
        />
      )}
    </main>
  );
}
