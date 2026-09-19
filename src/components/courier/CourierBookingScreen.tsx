// Customer courier booking: pickup, drop, parcel, server fare, payment.
// The fare shown here always comes from the server quote; nothing is computed
// on the device.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Bike, Loader2, MapPin, Package } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { courierQuote, courierCreateOrder, courierConfirmPayment } from "@/lib/courier.functions";
import { payWithRazorpay } from "@/lib/razorpayCheckout";
import { toPaymentError, paymentErrorKey } from "@/lib/paymentError";
import { useT } from "@/i18n";
import { fetchCourierVehicles, fetchCourierTypes } from "./courierData";

type Addr = {
  id: string;
  label: string | null;
  full_address: string;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
};

async function fetchAddresses(): Promise<Addr[]> {
  const { data, error } = await supabase
    .from("addresses")
    .select("id, label, full_address, city, latitude, longitude")
    .order("is_default", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Addr[];
}

type Quote = {
  total_amount?: number;
  base_amount?: number;
  extra_fee?: number;
  platform_fee?: number;
  gst_amount?: number;
  discount_amount?: number;
  distance_km?: number;
  error?: string;
};

export function CourierBookingScreen({
  onBack,
  onBooked,
}: {
  onBack: () => void;
  onBooked: (orderId: string) => void;
}) {
  const t = useT();
  const [step, setStep] = useState<1 | 2 | 3>(1);
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
  const { data: vehicles = [] } = useQuery({
    queryKey: ["courier_vehicles"],
    queryFn: fetchCourierVehicles,
  });
  const { data: types = [] } = useQuery({
    queryKey: ["courier_types", vehicleId],
    queryFn: () => fetchCourierTypes(vehicleId),
    enabled: !!vehicleId,
  });

  useEffect(() => {
    if (!vehicleId && vehicles.length) setVehicleId(vehicles[0].id);
  }, [vehicles, vehicleId]);
  useEffect(() => {
    if (types.length && !types.some((x) => x.id === typeId)) setTypeId(types[0].id);
  }, [types, typeId]);

  const city = pickup?.city || drop?.city || "Latur";
  const ready =
    pickup?.latitude != null &&
    drop?.latitude != null &&
    pickupName.trim() &&
    pickupPhone.replace(/\D/g, "").length === 10 &&
    dropName.trim() &&
    dropPhone.replace(/\D/g, "").length === 10 &&
    vehicleId &&
    typeId;

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
      const q = (await courierQuote({ data: payload })) as Quote;
      setQuote(q);
      setStep(3);
    } catch (e) {
      setErr((e as Error).message || "Could not get the price right now.");
    } finally {
      setQuoting(false);
    }
  };

  const pay = async () => {
    if (!confirmed) {
      setErr("Please confirm there are no banned items in the parcel.");
      return;
    }
    setErr(null);
    setPaying(true);
    try {
      const order = await courierCreateOrder({
        data: {
          ...payload,
          pickup_address: pickup!.full_address,
          pickup_contact_name: pickupName.trim(),
          pickup_contact_phone: pickupPhone.replace(/\D/g, "").slice(-10),
          drop_address: drop!.full_address,
          drop_contact_name: dropName.trim(),
          drop_contact_phone: dropPhone.replace(/\D/g, "").slice(-10),
          package_description: note.trim() || undefined,
          prohibited_items_confirmed: true as const,
        },
      });
      const res = await payWithRazorpay({
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
          razorpay_payment_id: res.razorpay_payment_id,
          razorpay_order_id: res.razorpay_order_id,
        },
      });
      onBooked(order.order_id);
    } catch (e) {
      const pe = toPaymentError(e);
      console.error("[courier] payment error", e);
      if (pe.category === "cancelled") {
        toast(t("payment.cancelledToast"));
      } else if (pe.parsed?.raw && !pe.parsed.code && !pe.parsed.description) {
        setErr((e as Error).message || t(paymentErrorKey(pe.category)));
      } else {
        setErr(t(paymentErrorKey(pe.category)));
      }
    } finally {
      setPaying(false);
    }
  };

  const AddrPick = ({
    title,
    value,
    onPick,
  }: {
    title: string;
    value: Addr | null;
    onPick: (a: Addr) => void;
  }) => (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <div className="space-y-2">
        {addresses.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => onPick(a)}
            className={`flex w-full items-start gap-2 rounded-xl border p-3 text-left ${
              value?.id === a.id ? "border-primary bg-primary/5" : "border-border bg-card"
            }`}
          >
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span className="text-sm">
              <span className="block font-medium">{a.label || "Address"}</span>
              <span className="block text-muted-foreground">{a.full_address}</span>
            </span>
          </button>
        ))}
        {!addresses.length && (
          <p className="text-sm text-muted-foreground">
            Add an address in your profile first, then come back here.
          </p>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-background pb-28">
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background px-4 pb-3 pt-[calc(env(safe-area-inset-top)+12px)]">
        <button type="button" onClick={onBack} aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-base font-semibold">Send a parcel</h1>
      </div>

      <div className="space-y-5 px-4 py-4">
        {step === 1 && (
          <>
            <AddrPick title="Pickup from" value={pickup} onPick={setPickup} />
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="Pickup contact name"
                value={pickupName}
                onChange={(e) => setPickupName(e.target.value)}
              />
              <Input
                placeholder="10-digit mobile"
                inputMode="numeric"
                value={pickupPhone}
                onChange={(e) => setPickupPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
              />
            </div>
            <AddrPick title="Deliver to" value={drop} onPick={setDrop} />
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="Drop contact name"
                value={dropName}
                onChange={(e) => setDropName(e.target.value)}
              />
              <Input
                placeholder="10-digit mobile"
                inputMode="numeric"
                value={dropPhone}
                onChange={(e) => setDropPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
              />
            </div>
            <Button className="w-full" disabled={!pickup || !drop} onClick={() => setStep(2)}>
              Continue
            </Button>
          </>
        )}

        {step === 2 && (
          <>
            <p className="text-sm font-semibold">Vehicle</p>
            <div className="flex gap-2">
              {vehicles.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setVehicleId(v.id)}
                  className={`flex-1 rounded-xl border p-3 text-sm ${
                    vehicleId === v.id ? "border-primary bg-primary/5" : "border-border bg-card"
                  }`}
                >
                  <Bike className="mx-auto mb-1 h-5 w-5 text-primary" />
                  {v.name}
                  {v.max_weight_kg ? (
                    <span className="block text-xs text-muted-foreground">
                      up to {v.max_weight_kg} kg
                    </span>
                  ) : null}
                </button>
              ))}
            </div>

            <p className="text-sm font-semibold">What are you sending?</p>
            <div className="grid grid-cols-2 gap-2">
              {types.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setTypeId(c.id)}
                  className={`rounded-xl border p-3 text-sm ${
                    typeId === c.id ? "border-primary bg-primary/5" : "border-border bg-card"
                  }`}
                >
                  <Package className="mx-auto mb-1 h-5 w-5 text-primary" />
                  {c.name}
                </button>
              ))}
            </div>

            <Input
              placeholder="Approx weight in kg"
              inputMode="decimal"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
            <Input
              placeholder="Any note for the rider (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />

            {err && <p className="text-sm text-destructive">{err}</p>}
            <Button className="w-full" disabled={!ready || quoting} onClick={getQuote}>
              {quoting ? <Loader2 className="h-4 w-4 animate-spin" /> : "See price"}
            </Button>
          </>
        )}

        {step === 3 && quote && (
          <>
            <div className="rounded-2xl border border-border bg-card p-4">
              <p className="text-sm text-muted-foreground">
                Distance {quote.distance_km ?? "-"} km
              </p>
              <div className="mt-3 space-y-1 text-sm">
                <Row label="Delivery charge" value={quote.base_amount} />
                {!!quote.extra_fee && <Row label="Parcel handling" value={quote.extra_fee} />}
                {!!quote.platform_fee && <Row label="Platform fee" value={quote.platform_fee} />}
                {!!quote.discount_amount && (
                  <Row label="Discount" value={-Number(quote.discount_amount)} />
                )}
                {!!quote.gst_amount && <Row label="GST" value={quote.gst_amount} />}
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-base font-semibold">
                <span>Total</span>
                <span>₹{Number(quote.total_amount ?? 0).toFixed(2)}</span>
              </div>
            </div>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-1"
              />
              <span>
                I confirm the parcel has no cash, jewellery, alcohol, or any illegal or banned item.
              </span>
            </label>

            {err && <p className="text-sm text-destructive">{err}</p>}
            <Button className="w-full" disabled={paying} onClick={pay}>
              {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : "Pay & book"}
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => setStep(2)}>
              Back
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: number }) {
  return (
    <div className="flex items-center justify-between text-muted-foreground">
      <span>{label}</span>
      <span>₹{Number(value ?? 0).toFixed(2)}</span>
    </div>
  );
}
