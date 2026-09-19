/**
 * One entry point for every Razorpay payment in the app.
 *
 * Web (and any build where the native payment sheet is unavailable):
 * loads Razorpay's JS Checkout and opens it in the page — exactly what the
 * app did before.
 *
 * Android app (once the native plugin ships in a new APK): opens Razorpay's
 * NATIVE payment sheet. This is the only way UPI apps (GPay / PhonePe /
 * Paytm) can be launched, because a WebView is not allowed to hand a payment
 * over to another app — which is why those options are missing today.
 *
 * The native plugin is registered by NAME (`Checkout`, the plugin id exposed
 * by Razorpay's own `capacitor-razorpay` package) instead of imported from
 * npm, so the web bundle stays dependency-free and the current APK keeps
 * working unchanged. When the native side is missing inside the app we log a
 * warning and fall back to the web sheet — never silently.
 * See native/android/MANUAL_MERGE.md for the build step.
 */
import { registerPlugin, Capacitor } from "@capacitor/core";
import { isNativeShell } from "@/lib/nativeServerFn";
import {
  mapRazorpayError,
  parseRazorpayError,
  type ParsedRazorpayError,
  type RazorpayErrorCategory,
} from "@/lib/paymentError";

export type RazorpaySuccess = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};

export type RazorpayCheckoutOptions = {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  description?: string;
  contact?: string;
  email?: string;
  name?: string;
};

/**
 * Every checkout failure surfaces as this error, already classified.
 * Screens read `category` and show a translated line — never `message`.
 */
export class RazorpayPaymentError extends Error {
  category: RazorpayErrorCategory;
  parsed: ParsedRazorpayError;
  constructor(category: RazorpayErrorCategory, parsed: ParsedRazorpayError) {
    super(parsed.raw || category);
    this.name = "RazorpayPaymentError";
    this.category = category;
    this.parsed = parsed;
  }
}

/** Thrown when the customer closes the sheet without paying. */
export class PaymentCancelledError extends RazorpayPaymentError {
  constructor(raw = "payment_cancelled") {
    super("cancelled", parseRazorpayError(raw));
    this.name = "PaymentCancelledError";
  }
}

/** Classifies anything thrown by either checkout into our error type. */
export function toPaymentError(err: unknown): RazorpayPaymentError {
  if (err instanceof RazorpayPaymentError) return err;
  const { category, parsed } = mapRazorpayError(err);
  if (category === "cancelled") return new PaymentCancelledError(parsed.raw);
  return new RazorpayPaymentError(category, parsed);
}

type WebRazorpayOptions = {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description?: string;
  prefill?: { name?: string; email?: string; contact?: string };
  theme?: { color?: string };
  handler: (response: RazorpaySuccess) => void;
  modal?: { ondismiss?: () => void };
};

declare global {
  interface Window {
    Razorpay?: new (options: WebRazorpayOptions) => {
      open: () => void;
      on?: (event: string, cb: (payload: unknown) => void) => void;
    };
  }
}

const SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

function loadWebCheckout(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve(false);
    if (window.Razorpay) return resolve(true);
    const existing = document.querySelector(
      `script[src="${SCRIPT_SRC}"]`,
    ) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve(true));
      existing.addEventListener("error", () => resolve(false));
      return;
    }
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

/** Native Razorpay plugin surface (provided by the Android build). */
type NativeCheckoutPlugin = {
  open(options: Record<string, unknown>): Promise<{
    response?: Partial<RazorpaySuccess>;
  } & Partial<RazorpaySuccess>>;
};

const NativeCheckout = registerPlugin<NativeCheckoutPlugin>("Checkout");

let warnedMissingPlugin = false;

function nativeSheetAvailable(): boolean {
  try {
    if (!isNativeShell()) return false;
    if (Capacitor.isPluginAvailable("Checkout")) return true;
    if (!warnedMissingPlugin) {
      warnedMissingPlugin = true;
      console.warn(
        "[razorpay] native Checkout plugin missing — falling back to the web sheet, " +
          "so UPI apps (GPay/PhonePe/Paytm) will not be listed. Run " +
          "`npm install capacitor-razorpay && npx cap sync android` (see native/android/MANUAL_MERGE.md).",
      );
    }
    return false;
  } catch {
    return false;
  }
}


async function openNative(opts: RazorpayCheckoutOptions): Promise<RazorpaySuccess> {
  const result = await NativeCheckout.open({
    key: opts.key,
    order_id: opts.order_id,
    amount: opts.amount,
    currency: opts.currency,
    name: opts.name ?? "badiyos",
    description: opts.description,
    prefill: { contact: opts.contact, email: opts.email },
    theme: { color: "#00B97A" },
  });

  const payload = (result?.response ?? result) as Partial<RazorpaySuccess>;
  if (!payload?.razorpay_payment_id) {
    throw new Error("Payment could not be completed");
  }
  return {
    razorpay_payment_id: payload.razorpay_payment_id,
    razorpay_order_id: payload.razorpay_order_id ?? opts.order_id,
    razorpay_signature: payload.razorpay_signature ?? "",
  };
}

function openWeb(opts: RazorpayCheckoutOptions): Promise<RazorpaySuccess> {
  return new Promise<RazorpaySuccess>((resolve, reject) => {
    void loadWebCheckout().then((ok) => {
      if (!ok || !window.Razorpay) {
        reject(toPaymentError("network: failed to load razorpay checkout"));
        return;
      }
      let settled = false;
      const rzp = new window.Razorpay({
        key: opts.key,
        order_id: opts.order_id,
        amount: opts.amount,
        currency: opts.currency,
        name: opts.name ?? "badiyos",
        description: opts.description,
        prefill: { contact: opts.contact, email: opts.email },
        theme: { color: "#00B97A" },
        handler: (resp) => {
          settled = true;
          resolve(resp);
        },
        modal: {
          ondismiss: () => {
            if (settled) return;
            settled = true;
            reject(new PaymentCancelledError());
          },
        },
      });
      // Bank / card / UPI rejections arrive here, not via ondismiss.
      try {
        rzp.on?.("payment.failed", (payload: unknown) => {
          if (settled) return;
          settled = true;
          reject(toPaymentError(payload));
        });
      } catch {
        /* older checkout builds have no event bus */
      }
      rzp.open();
    });
  });
}

/**
 * Opens Razorpay and resolves with the payment details once the customer has
 * paid. Always rejects with {@link RazorpayPaymentError} (a
 * {@link PaymentCancelledError} when the customer closed the sheet).
 */
export async function payWithRazorpay(
  opts: RazorpayCheckoutOptions,
): Promise<RazorpaySuccess> {
  if (nativeSheetAvailable()) {
    try {
      return await openNative(opts);
    } catch (err) {
      throw toPaymentError(err);
    }
  }
  try {
    return await openWeb(opts);
  } catch (err) {
    throw toPaymentError(err);
  }
}
