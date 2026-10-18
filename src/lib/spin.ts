import { supabase } from "@/integrations/supabase/client";
import { getDeviceId } from "@/lib/deviceId";

export type SpinSlice = {
  slice_index: number; prize_id: string; label: string; label_mr: string;
  color: string; icon: string | null; type: string; sold_out: boolean;
};
export type SpinEvent = { event_id: string; name: string; name_mr: string; ends_at: string; slices: SpinSlice[] };
export type SpinPrize = {
  prize_id: string; slice_index: number; label: string; label_mr: string; type: string;
  value: number; redemption_code: string | null; redeemed: boolean; won_at: string;
};
export type SpinStatus =
  | { status: "eligible" | "sign_in" | "not_live" | "not_eligible" | "device_used" | "phone_used" }
  | { status: "already_spun"; prize: SpinPrize };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as any)(fn, args);

export async function fetchSpinEvent(cityId: string | null): Promise<SpinEvent | null> {
  const { data, error } = await rpc("app_spin_event", { _city_id: cityId });
  if (error) throw error;
  return (data as SpinEvent) ?? null;
}

export async function fetchSpinStatus(eventId: string): Promise<SpinStatus> {
  const { data, error } = await rpc("app_spin_status", { _event_id: eventId, _device_id: await getDeviceId() });
  if (error) throw error;
  return data as SpinStatus;
}

const reqKey = (eventId: string) => `badiyo.spin_req.${eventId}`;

/** One request ID per event; retries reuse it so the server returns the same draw. */
function requestId(eventId: string): string {
  let id = localStorage.getItem(reqKey(eventId));
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(reqKey(eventId), id);
  }
  return id;
}

export async function doSpin(eventId: string): Promise<SpinPrize> {
  const rid = requestId(eventId);
  const device = await getDeviceId();
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await rpc("app_spin", { _event_id: eventId, _request_id: rid, _device_id: device });
    if (!error && data) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = data as any;
      if (d.error || d.ok === false) throw new Error(d.error ?? d.message ?? "spin_failed");
      const prize = (d.prize ?? d) as SpinPrize;
      if (prize && typeof prize.slice_index === "number") return prize;
    }
    lastErr = error;
    // Business errors (not network) are final.
    if (error && error.code && error.code !== "PGRST000" && !/fetch|network/i.test(error.message)) throw error;
    await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
  }
  throw lastErr ?? new Error("network");
}

export type MySpinPrize = {
  draw_id: string; event_name: string; event_name_mr: string | null; event_starts_at: string | null;
  prize: string; prize_mr: string | null; color: string | null; icon: string | null;
  code: string | null; qr: string | null; won_at: string; expires_at: string | null;
  status: "won" | "pending_undo" | "redeemed" | "expired";
  redeemed_at: string | null; undo_deadline: string | null;
  customer_name: string | null; phone_masked: string | null;
};

export async function fetchMySpinPrizes(): Promise<MySpinPrize[]> {
  const { data: s } = await supabase.auth.getSession();
  if (!s.session) return [];
  const { data, error } = await rpc("app_my_spin_prizes", {});
  if (error) throw error;
  return (data as MySpinPrize[]) ?? [];
}

export async function redeemSpinPrize(drawId: string) {
  const { data, error } = await rpc("app_spin_prize_redeem", { _draw_id: drawId });
  if (error) throw error;
  return data as { ok: boolean; status: string; undo_deadline: string };
}

export async function undoSpinPrize(drawId: string) {
  const { data, error } = await rpc("app_spin_prize_undo", { _draw_id: drawId });
  if (error) throw error;
  return data as { ok: boolean; status: string };
}
