// Customer parcel booking: guided locations, vehicle, parcel and review flow.
// Fare and payment remain server-authoritative.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  Loader2,
  MapPinned,
  Package,
  Pencil,
  Phone,
  Plus,
  Route as RouteIcon,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import courierBike from "@/assets/courier-bike.png";
import { AddressSelectionScreen } from "@/components/AddressSelectionScreen";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { getAuthUser } from "@/lib/authUser";
import { courierQuote, courierCreateOrder, courierConfirmPayment } from "@/lib/courier.functions";
import { payWithRazorpay, toPaymentError } from "@/lib/razorpayCheckout";
import { paymentErrorKey } from "@/lib/paymentError";
import { useT } from "@/i18n";
import { fetchCourierVehicles, fetchCourierTypes, fetchCourierService } from "./courierData";

type Addr = {
  id: string;
  label: string | null;
  full_address: string;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  is_default: boolean | null;
};

type Quote = {
  total_amount?: number;
  base_amount?: number;
  extra_fee?: number;
  platform_fee?: number;
  gst_amount?: number;
  discount_amount?: number;
  distance_km?: number;
};

type Step = 1 | 2 | 3 | 4;
type AddressTarget = "pickup" | "drop";

async function fetchAddresses(): Promise<Addr[]> {
  const { data, error } = await supabase
    .from("addresses")
    .select("id, label, full_address, city, latitude, longitude, is_default")
    .order("is_default", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Addr[];
}

async function fetchCourierProfile() {
  const { data: auth } = await getAuthUser();
  const uid = auth.user?.id;
  if (!uid) return { name: "", phone: "" };
  const { data } = await supabase.from("users").select("full_name, phone").eq("id", uid).maybeSingle();
  return {
    name: data?.full_name?.trim() ?? "",
    phone: (data?.phone ?? auth.user?.phone ?? "").replace(/\D/g, "").slice(-10),
  };
}

export function CourierBookingScreen({
  onBack,
  onBooked,
}: {
  onBack: () => void;
  onBooked: (orderId: string) => void;
}) {
  const t = useT();
  const [step, setStep] = useState<Step>(1);
  const [addressTarget, setAddressTarget] = useState<AddressTarget | null>(null);
  const [pickup, setPickup] = useState<Addr | null>(null);
  const [drop, setDrop] = useState<Addr | null>(null);
  const [pickupName, setPickupName] = useState("");
  const [pickupPhone, setPickupPhone] = useState("");
  const [dropName, setDropName] = useState("");
  const [dropPhone, setDropPhone] = useState("");
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [weight, setWeight] = useState("1");
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [paying, setPaying] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const { data: addresses = [] } = useQuery({ queryKey: ["addresses"], queryFn: fetchAddresses });
  const { data: profile } = useQuery({ queryKey: ["courier_profile"], queryFn: fetchCourierProfile });
  const { data: vehicles = [] } = useQuery({ queryKey: ["courier_vehicles"], queryFn: fetchCourierVehicles });
  const { data: types = [] } = useQuery({
    queryKey: ["courier_types", vehicleId],
    queryFn: () => fetchCourierTypes(vehicleId),
    enabled: Boolean(vehicleId),
  });
  const { data: courierService } = useQuery({
    queryKey: ["courier_service"],
    queryFn: () => fetchCourierService(),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!vehicleId && vehicles.length) setVehicleId(vehicles[0].id);
  }, [vehicles, vehicleId]);
  useEffect(() => {
    if (types.length && !types.some((item) => item.id === typeId)) setTypeId(types[0].id);
  }, [types, typeId]);
  useEffect(() => {
    if (!pickup && addresses.length) setPickup(addresses.find((item) => item.is_default) ?? addresses[0]);
  }, [addresses, pickup]);
  useEffect(() => {
    if (!profile) return;
    setPickupName((value) => value || profile.name);
    setPickupPhone((value) => value || profile.phone);
  }, [profile]);

  const city = (pickup?.city || drop?.city || "").trim() || courierService?.city || "Latur";
  const selectedVehicle = vehicles.find((item) => item.id === vehicleId) ?? null;
  const selectedType = types.find((item) => item.id === typeId) ?? null;
  const validPhone = (value: string) => value.replace(/\D/g, "").length === 10;
  const locationsReady = Boolean(
    pickup?.latitude != null &&
      pickup.longitude != null &&
      drop?.latitude != null &&
      drop.longitude != null &&
      pickupName.trim() &&
      validPhone(pickupPhone) &&
      dropName.trim() &&
      validPhone(dropPhone),
  );
  const parcelReady = Boolean(vehicleId && typeId && Number(weight) > 0);

  const payload = useMemo(
    () => ({
      city,
      vehicle_type_id: vehicleId ?? "",
      courier_type_id: typeId ?? "",
      pickup: { lat: Number(pickup?.latitude ?? 0), lng: Number(pickup?.longitude ?? 0) },
      drop: { lat: Number(drop?.latitude ?? 0), lng: Number(drop?.longitude ?? 0) },
      weight_kg: Math.max(0, Number(weight) || 0),
    }),
    [city, vehicleId, typeId, pickup, drop, weight],
  );

  const getQuote = async () => {
    setErr(null);
    setQuoting(true);
    try {
      setQuote((await courierQuote({ data: payload })) as Quote);
      setStep(4);
    } catch (error) {
      setErr((error as Error).message || t("courier.priceError"));
    } finally {
      setQuoting(false);
    }
  };

  const pay = async () => {
    if (!confirmed) {
      setErr(t("courier.confirmRequired"));
      return;
    }
    if (!pickup || !drop) return;
    setErr(null);
    setPaying(true);
    try {
      const order = await courierCreateOrder({
        data: {
          ...payload,
          pickup_address: pickup.full_address,
          pickup_contact_name: pickupName.trim(),
          pickup_contact_phone: pickupPhone.replace(/\D/g, "").slice(-10),
          drop_address: drop.full_address,
          drop_contact_name: dropName.trim(),
          drop_contact_phone: dropPhone.replace(/\D/g, "").slice(-10),
          package_description: note.trim() || undefined,
          prohibited_items_confirmed: true as const,
        },
      });
      const result = await payWithRazorpay({
        key: order.key_id,
        amount: order.amount,
        currency: "INR",
        order_id: order.razorpay_order_id,
        name: "Badiyos",
        description: "Parcel delivery",
      });
      await courierConfirmPayment({
        data: {
          order_id: order.order_id,
          razorpay_payment_id: result.razorpay_payment_id,
          razorpay_order_id: result.razorpay_order_id,
        },
      });
      onBooked(order.order_id);
    } catch (error) {
      const paymentError = toPaymentError(error);
      console.error("[courier] payment error", error);
      if (paymentError.category === "cancelled") toast(t("payment.cancelledToast"));
      else setErr(t(paymentErrorKey(paymentError.category)));
    } finally {
      setPaying(false);
    }
  };

  if (addressTarget) {
    return (
      <AddressSelectionScreen
        onBack={() => setAddressTarget(null)}
        onContinue={(address) => {
          const next = address as Addr;
          if (addressTarget === "pickup") setPickup(next);
          else setDrop(next);
          setAddressTarget(null);
        }}
      />
    );
  }

  const goBack = () => {
    setErr(null);
    if (step === 1) onBack();
    else setStep((step - 1) as Step);
  };

  return (
    <main className="min-h-dvh bg-background pb-28">
      <header className="sticky top-0 z-20 border-b border-border bg-card px-4 pb-3 pt-[calc(env(safe-area-inset-top)+12px)]">
        <div className="mx-auto flex w-full max-w-md items-center gap-3">
          <Button type="button" variant="ghost" size="icon" onClick={goBack} aria-label={t("common.back")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-extrabold text-foreground">{t("courier.title")}</h1>
            <p className="text-xs text-muted-foreground">{t("courier.subtitle")}</p>
          </div>
          <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">
            {step}/4
          </span>
        </div>
        <div className="mx-auto mt-3 grid w-full max-w-md grid-cols-4 gap-1" aria-label={t("courier.progress")}>
          {(["courier.step1", "courier.step2", "courier.step3", "courier.step4"] as const).map((key, index) => (
            <div key={key} className="min-w-0">
              <div className={`h-1 rounded-full ${index < step ? "bg-primary" : "bg-muted"}`} />
              <span className={`mt-1 block truncate text-center text-[10px] font-bold ${index < step ? "text-primary" : "text-muted-foreground"}`}>
                {t(key)}
              </span>
            </div>
          ))}
        </div>
      </header>

      <div className="mx-auto w-full max-w-md px-4 py-5">
        {step === 1 && (
          <section className="animate-fade-slide-in space-y-5">
            <div>
              <h2 className="text-xl font-extrabold text-foreground">{t("courier.routeTitle")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t("courier.routeSub")}</p>
            </div>
            <div className="relative overflow-hidden rounded-lg border border-border bg-card shadow-card-m">
              <div className="absolute bottom-14 left-[31px] top-14 border-l-2 border-dashed border-border" />
              <AddressStop kind="pickup" address={pickup} onClick={() => setAddressTarget("pickup")} />
              <div className="mx-5 border-t border-border" />
              <AddressStop kind="drop" address={drop} onClick={() => setAddressTarget("drop")} />
            </div>

            <ContactFields
              title={t("courier.pickupContact")}
              name={pickupName}
              phone={pickupPhone}
              onName={setPickupName}
              onPhone={setPickupPhone}
            />
            <ContactFields
              title={t("courier.dropContact")}
              name={dropName}
              phone={dropPhone}
              onName={setDropName}
              onPhone={setDropPhone}
            />
            <Button className="h-12 w-full text-base font-bold" disabled={!locationsReady} onClick={() => setStep(2)}>
              {t("courier.continueBike")} <ChevronRight />
            </Button>
          </section>
        )}

        {step === 2 && (
          <section className="animate-fade-slide-in space-y-5">
            <RouteSummary pickup={pickup} drop={drop} onEdit={() => setStep(1)} />
            <div>
              <h2 className="text-xl font-extrabold text-foreground">{t("courier.chooseRide")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t("courier.chooseRideSub")}</p>
            </div>
            <div className="space-y-3">
              {vehicles.map((vehicle) => {
                const active = vehicle.id === vehicleId;
                return (
                  <Button
                    key={vehicle.id}
                    type="button"
                    variant="outline"
                    onClick={() => setVehicleId(vehicle.id)}
                    className={`relative h-auto w-full justify-start overflow-hidden whitespace-normal rounded-lg p-0 text-left ${active ? "border-2 border-primary bg-primary/5" : "border-border bg-card"}`}
                  >
                    <div className="grid w-full grid-cols-[minmax(0,1fr)_148px] items-center">
                      <div className="min-w-0 p-5">
                        <div className="flex items-center gap-2">
                          <span className="text-xl font-extrabold text-foreground">{vehicle.name}</span>
                          {active && <Check className="h-5 w-5 text-primary" />}
                        </div>
                        <p className="mt-2 text-sm font-semibold text-muted-foreground">
                          {vehicle.max_weight_kg ? t("courier.upToKg", { weight: vehicle.max_weight_kg }) : t("courier.smallParcels")}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">{t("courier.doorstepDelivery")}</p>
                      </div>
                      <div className="flex h-40 items-center justify-center bg-primary/10 p-2">
                        <img src={courierBike} alt="Delivery bike" width={1024} height={768} loading="lazy" className="h-auto w-full object-contain" />
                      </div>
                    </div>
                  </Button>
                );
              })}
            </div>
            {!vehicles.length && <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">{t("courier.noVehicles")}</p>}
            <Button className="h-12 w-full text-base font-bold" disabled={!vehicleId} onClick={() => setStep(3)}>
              {t("courier.continueParcel")} <ChevronRight />
            </Button>
          </section>
        )}

        {step === 3 && (
          <section className="animate-fade-slide-in space-y-5">
            <RouteSummary pickup={pickup} drop={drop} onEdit={() => setStep(1)} />
            <div>
              <h2 className="text-xl font-extrabold text-foreground">{t("courier.whatSending")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t("courier.whatSendingSub")}</p>
            </div>
            <div className="rounded-lg border border-warning/40 bg-warning/10 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
                <div>
                  <p className="text-sm font-extrabold text-foreground">{t("courier.restricted")}</p>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{t("courier.restrictedSub")}</p>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {types.map((type) => {
                const active = type.id === typeId;
                return (
                  <Button
                    key={type.id}
                    type="button"
                    variant="outline"
                    onClick={() => setTypeId(type.id)}
                    className={`h-24 min-w-0 flex-col whitespace-normal rounded-lg px-3 text-center ${active ? "border-2 border-primary bg-primary/5 text-primary" : "border-border bg-card text-foreground"}`}
                  >
                    <Package className="h-5 w-5" />
                    <span className="line-clamp-2 font-bold">{type.name}</span>
                  </Button>
                );
              })}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1.5 text-sm font-bold text-foreground">
                {t("courier.weight")}
                <Input inputMode="decimal" value={weight} onChange={(event) => setWeight(event.target.value)} className="h-12" />
              </label>
              <label className="space-y-1.5 text-sm font-bold text-foreground">
                {t("courier.note")}
                <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder={t("courier.notePlaceholder")} className="h-12" />
              </label>
            </div>
            {err && <p className="rounded-lg bg-destructive/10 p-3 text-sm font-semibold text-destructive">{err}</p>}
            <Button className="h-12 w-full text-base font-bold" disabled={!parcelReady || quoting} onClick={getQuote}>
              {quoting ? <Loader2 className="animate-spin" /> : t("courier.reviewPrice")} {!quoting && <ChevronRight />}
            </Button>
          </section>
        )}

        {step === 4 && quote && (
          <section className="animate-fade-slide-in space-y-5">
            <div>
              <h2 className="text-xl font-extrabold text-foreground">{t("courier.reviewTitle")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t("courier.reviewSub")}</p>
            </div>
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <div className="grid grid-cols-[92px_minmax(0,1fr)] items-center bg-primary/5">
                <img src={courierBike} alt="Delivery bike" width={1024} height={768} loading="lazy" className="h-24 w-24 object-contain p-2" />
                <div className="min-w-0 pr-4">
                  <p className="text-lg font-extrabold text-foreground">{selectedVehicle?.name ?? t("courier.bike")}</p>
                  <p className="text-sm text-muted-foreground">{selectedType?.name} · {weight} kg</p>
                </div>
              </div>
              <div className="border-t border-border p-4"><RouteSummary pickup={pickup} drop={drop} onEdit={() => setStep(1)} embedded /></div>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="font-extrabold text-foreground">{t("courier.fareSummary")}</p>
                <span className="text-xs font-bold text-primary">{quote.distance_km ?? "–"} km</span>
              </div>
              <div className="space-y-2 text-sm">
                <FareRow label={t("courier.deliveryCharge")} value={quote.base_amount} />
                {!!quote.extra_fee && <FareRow label={t("courier.handling")} value={quote.extra_fee} />}
                {!!quote.platform_fee && <FareRow label={t("courier.platformFee")} value={quote.platform_fee} />}
                {!!quote.discount_amount && <FareRow label={t("courier.discount")} value={-Number(quote.discount_amount)} />}
                {!!quote.gst_amount && <FareRow label={t("courier.gst")} value={quote.gst_amount} />}
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-border pt-4 text-lg font-extrabold text-foreground">
                <span>{t("common.total")}</span><span>₹{Number(quote.total_amount ?? 0).toFixed(2)}</span>
              </div>
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-4 text-sm">
              <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5 h-5 w-5 accent-primary" />
              <span className="leading-5 text-foreground">{t("courier.confirmSafe")}</span>
            </label>
            {err && <p className="rounded-lg bg-destructive/10 p-3 text-sm font-semibold text-destructive">{err}</p>}
          </section>
        )}
      </div>

      {step === 4 && quote && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card safe-bottom">
          <div className="mx-auto grid w-full max-w-md grid-cols-[auto_minmax(0,1fr)] items-center gap-4 px-4 py-3">
            <div className="shrink-0">
              <p className="text-xs text-muted-foreground">{t("common.total")}</p>
              <p className="text-xl font-extrabold text-foreground">₹{Number(quote.total_amount ?? 0).toFixed(2)}</p>
            </div>
            <Button className="h-12 min-w-0 text-base font-bold" disabled={paying || !confirmed} onClick={pay}>
              {paying ? <Loader2 className="animate-spin" /> : t("courier.payBook", { vehicle: selectedVehicle?.name ?? t("courier.bike") })}
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}

function AddressStop({ kind, address, onClick }: { kind: AddressTarget; address: Addr | null; onClick: () => void }) {
  const t = useT();
  const pickup = kind === "pickup";
  return (
    <Button type="button" variant="ghost" onClick={onClick} className="grid h-auto w-full grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 whitespace-normal rounded-none px-4 py-4 text-left">
      <span className={`grid h-9 w-9 place-items-center rounded-full ${pickup ? "bg-primary text-primary-foreground" : "bg-destructive text-destructive-foreground"}`}>
        {pickup ? <RouteIcon className="h-4 w-4" /> : <MapPinned className="h-4 w-4" />}
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-bold text-muted-foreground">{pickup ? t("courier.pickupFrom") : t("courier.deliverTo")}</span>
        <span className={`mt-0.5 block truncate text-sm font-extrabold ${address ? "text-foreground" : "text-primary"}`}>{address?.label || (pickup ? t("courier.choosePickup") : t("courier.chooseDrop"))}</span>
        {address && <span className="mt-0.5 block line-clamp-1 text-xs font-normal text-muted-foreground">{address.full_address}</span>}
      </span>
      {address ? <Pencil className="h-4 w-4 text-primary" /> : <Plus className="h-5 w-5 text-primary" />}
    </Button>
  );
}

function ContactFields({ title, name, phone, onName, onPhone }: { title: string; name: string; phone: string; onName: (value: string) => void; onPhone: (value: string) => void }) {
  const t = useT();
  return (
    <div>
      <h3 className="mb-2 text-sm font-extrabold text-foreground">{title}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="relative"><UserRound className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" /><Input value={name} onChange={(event) => onName(event.target.value)} placeholder={t("courier.contactName")} className="h-12 pl-10" /></div>
        <div className="relative"><Phone className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" /><Input inputMode="numeric" value={phone} onChange={(event) => onPhone(event.target.value.replace(/\D/g, "").slice(0, 10))} placeholder={t("courier.mobileNumber")} className="h-12 pl-10" /></div>
      </div>
    </div>
  );
}

function RouteSummary({ pickup, drop, onEdit, embedded = false }: { pickup: Addr | null; drop: Addr | null; onEdit: () => void; embedded?: boolean }) {
  const t = useT();
  return (
    <div className={embedded ? "" : "rounded-lg border border-border bg-card p-4"}>
      <div className="grid grid-cols-[20px_minmax(0,1fr)_auto] gap-x-3 gap-y-3">
        <span className="mt-1 h-3 w-3 rounded-full bg-primary" />
        <div className="min-w-0"><p className="text-xs font-bold text-muted-foreground">{t("courier.pickup")}</p><p className="truncate text-sm font-bold text-foreground">{pickup?.full_address}</p></div>
        <Button type="button" variant="ghost" size="sm" onClick={onEdit} className="row-span-2 self-center text-primary"><Pencil /> {t("common.edit")}</Button>
        <span className="mt-1 h-3 w-3 rounded-full bg-destructive" />
        <div className="min-w-0"><p className="text-xs font-bold text-muted-foreground">{t("courier.drop")}</p><p className="truncate text-sm font-bold text-foreground">{drop?.full_address}</p></div>
      </div>
    </div>
  );
}

function FareRow({ label, value }: { label: string; value?: number }) {
  return <div className="flex items-center justify-between text-muted-foreground"><span>{label}</span><span>₹{Number(value ?? 0).toFixed(2)}</span></div>;
}