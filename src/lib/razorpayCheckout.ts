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
 * The native plugin is registered by NAME (`Checkout`, the plugin id used by
 * `@capacitor-community/razorpay`) instead of imported from npm, so the web
 * bundle stays dependency-free and the current APK keeps working unchanged:
 * when the native side isn't present we transparently fall back to the web
 * sheet. See native/android/MANUAL_MERGE.md for the build step.
 */
import { registerPlugin, Capacitor } from "@capacitor/core";
import { isNativeShell } from "@/lib/nativeServerFn";

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

/** Thrown when the customer closes the sheet without paying. */
export class PaymentCancelledError extends Error {
  constructor(message = "Payment cancelled") {
    super(message);
    this.name = "PaymentCancelledError";
  }
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
    Razorpay?: new (options: WebRazorpayOptions) => { open: () => void };
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

function nativeSheetAvailable(): boolean {
  try {
    return isNativeShell() && Capacitor.isPluginAvailable("Checkout");
  } catch {
    return false;
  }
}

function isCancellation(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  return (
    msg.includes("cancel") ||
    msg.includes("dismiss") ||
    msg.includes("back pressed") ||
    msg.includes("user closed")
  );
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
        reject(new Error("Failed to load Razorpay Checkout"));
        return;
      }
      const rzp = new window.Razorpay({
        key: opts.key,
        order_id: opts.order_id,
        amount: opts.amount,
        currency: opts.currency,
        name: opts.name ?? "badiyos",
        description: opts.description,
        prefill: { contact: opts.contact, email: opts.email },
        theme: { color: "#00B97A" },
        handler: (resp) => resolve(resp),
        modal: { ondismiss: () => reject(new PaymentCancelledError()) },
      });
      rzp.open();
    });
  });
}

/**
 * Opens Razorpay and resolves with the payment details once the customer has
 * paid. Rejects with {@link PaymentCancelledError} if they close the sheet.
 */
export async function payWithRazorpay(
  opts: RazorpayCheckoutOptions,
): Promise<RazorpaySuccess> {
  if (nativeSheetAvailable()) {
    try {
      return await openNative(opts);
    } catch (err) {
      if (isCancellation(err)) throw new PaymentCancelledError();
      throw err instanceof Error ? err : new Error("Payment failed");
    }
  }
  return openWeb(opts);
}
