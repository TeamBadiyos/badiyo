/**
 * Turns anything Razorpay (native sheet or web checkout) throws into a small,
 * safe shape the UI can act on. Raw Razorpay text/JSON is NEVER shown to the
 * customer — screens use the category to pick a friendly, translated line.
 */

export type RazorpayErrorCategory =
  | "cancelled"
  | "declined"
  | "network"
  | "upi_unavailable"
  | "unknown";

export type ParsedRazorpayError = {
  code?: string;
  description?: string;
  source?: string;
  step?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  /** Everything we could read, for logging only. */
  raw: string;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** JSON string → object, otherwise null. */
function tryJson(text: string): Record<string, unknown> | null {
  const t = text.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return null;
  try {
    return asRecord(JSON.parse(t));
  } catch {
    return null;
  }
}

/**
 * Accepts: a string, a JSON string, an Error, a plain object, or any of those
 * nested one or more levels deep under `error` / `response` / `data` / `cause`.
 */
export function parseRazorpayError(input: unknown): ParsedRazorpayError {
  const rawParts: string[] = [];
  let node: unknown = input;
  let fields: Record<string, unknown> = {};

  for (let depth = 0; depth < 6 && node != null; depth += 1) {
    if (typeof node === "string") {
      rawParts.push(node);
      const parsed = tryJson(node);
      if (!parsed) break;
      node = parsed;
      continue;
    }

    if (node instanceof Error) {
      rawParts.push(node.message);
      const fromMessage = tryJson(node.message);
      const cause = (node as Error & { cause?: unknown }).cause;
      const next = fromMessage ?? asRecord(cause);
      if (!next) break;
      node = next;
      continue;
    }

    const rec = asRecord(node);
    if (!rec) break;

    try {
      rawParts.push(JSON.stringify(rec));
    } catch {
      /* circular — skip */
    }

    fields = { ...rec, ...fields };

    const nested =
      asRecord(rec["error"]) ??
      asRecord(rec["response"]) ??
      asRecord(rec["data"]) ??
      asRecord(rec["cause"]) ??
      (typeof rec["error"] === "string" ? tryJson(rec["error"] as string) : null) ??
      (typeof rec["message"] === "string" ? tryJson(rec["message"] as string) : null);
    if (!nested) break;
    node = nested;
  }

  return {
    code: str(fields["code"]),
    description: str(fields["description"]) ?? str(fields["message"]),
    source: str(fields["source"]),
    step: str(fields["step"]),
    reason: str(fields["reason"]),
    metadata: asRecord(fields["metadata"]) ?? undefined,
    raw: rawParts.filter(Boolean).join(" | ").slice(0, 4000) || String(input ?? ""),
  };
}

const CANCEL_HINTS = [
  "payment_cancelled",
  "payment cancelled",
  "cancelled by user",
  "canceled by user",
  "user cancel",
  "cancelled",
  "dismiss",
  "back pressed",
  "user closed",
  "closed by user",
];

const DECLINE_HINTS = [
  "payment_failed",
  "payment_declined",
  "declined",
  "insufficient",
  "authentication_failed",
  "card_declined",
  "do not honour",
  "do not honor",
  "limit exceeded",
  "invalid card",
  "invalid vpa",
  "expired card",
  "risk",
];

const NETWORK_HINTS = [
  "network",
  "timeout",
  "timed out",
  "connection",
  "offline",
  "unreachable",
  "failed to fetch",
  "failed to load razorpay",
];

const UPI_HINTS = [
  "upi app",
  "no upi",
  "upi_app",
  "activity not found",
  "no activity found",
  "app not installed",
  "package not found",
  "could not open",
  "intent",
];

function hit(haystack: string, hints: string[]) {
  return hints.some((h) => haystack.includes(h));
}

/**
 * Maps a parsed error onto one of the five customer-facing categories.
 * Anything we cannot place confidently becomes "unknown".
 */
export function mapRazorpayError(input: unknown): {
  category: RazorpayErrorCategory;
  parsed: ParsedRazorpayError;
} {
  const parsed = parseRazorpayError(input);
  const hay = [parsed.reason, parsed.description, parsed.code, parsed.step, parsed.raw]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  let category: RazorpayErrorCategory = "unknown";
  if (parsed.reason === "payment_cancelled" || hit(hay, CANCEL_HINTS)) {
    category = "cancelled";
  } else if (hit(hay, UPI_HINTS)) {
    category = "upi_unavailable";
  } else if (hit(hay, NETWORK_HINTS)) {
    category = "network";
  } else if (hit(hay, DECLINE_HINTS)) {
    category = "declined";
  }

  return { category, parsed };
}

/** i18n key for a category — screens must never print raw error text. */
export function paymentErrorKey(category: RazorpayErrorCategory) {
  return (
    {
      cancelled: "payment.errCancelled",
      declined: "payment.errDeclined",
      network: "payment.errNetwork",
      upi_unavailable: "payment.errUpi",
      unknown: "payment.errUnknown",
    } as const
  )[category];
}

/** Short customer-visible reference: last 6 chars of the Razorpay order id. */
export function paymentRefId(orderId?: string | null) {
  if (!orderId) return null;
  const s = String(orderId).replace(/[^a-zA-Z0-9]/g, "");
  return s.slice(-6).toUpperCase() || null;
}
