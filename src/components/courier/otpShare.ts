// Tiny, dependency-free OTP share helpers.
//
// These used to live in StopsTimeline.tsx, which pulls in Razorpay, dialogs and
// server functions. The Home screen only needs the two helpers below, so they
// live in their own module to keep the first-load bundle small.
import type { TFunction } from "@/i18n";
import type { CourierStop } from "./courierData";

export function shortAddress(a: string | null | undefined, t: TFunction) {
  return (a ?? "").split(",").slice(0, 2).join(",").trim() || t("courier.locationFallback");
}

export function typeLabel(type: CourierStop["stop_type"], t: TFunction) {
  return type === "pickup"
    ? t("courier.stopPickup")
    : type === "drop"
      ? t("courier.stopDrop")
      : t("courier.stopReturn");
}

/** Native share sheet, falling back to a WhatsApp link. */
export async function shareOtp(text: string) {
  try {
    if (typeof navigator !== "undefined" && navigator.share) {
      await navigator.share({ text });
      return;
    }
  } catch (e) {
    if ((e as Error)?.name === "AbortError") return;
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
}

export function otpShareText(
  type: CourierStop["stop_type"],
  address: string | null,
  otp: string,
  t: TFunction,
) {
  return t("courier.otpShare", {
    kind: typeLabel(type, t),
    address: shortAddress(address, t),
    otp,
  });
}

/** One message listing every visible drop code. */
export function otpShareAllText(
  orderCode: string | null | undefined,
  drops: Array<{ n: number; address: string | null; otp: string }>,
  t: TFunction,
) {
  const lines = drops.map((d) => `${t("courier.stopDrop")} ${d.n} (${shortAddress(d.address, t)}): ${d.otp}`);
  return [t("courier.shareAllHeader", { code: orderCode ?? "" }), ...lines, t("courier.shareAllFooter")].join("\n");
}
