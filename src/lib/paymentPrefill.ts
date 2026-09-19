/**
 * Builds the customer details Razorpay needs so checkout opens straight on
 * the payment methods screen instead of asking for a mobile number.
 *
 * Razorpay treats a missing OR malformed contact as "not provided" and shows
 * its own "Contact details" step, so the number is always normalised to
 * +91XXXXXXXXXX and empty fields are omitted entirely.
 */
import { supabase } from "@/integrations/supabase/client";
import { getAuthUser } from "@/lib/authUser";

export type PaymentPrefill = {
  name?: string;
  contact?: string;
  email?: string;
};

/** +91XXXXXXXXXX, or undefined when there is no usable 10-digit number. */
export function normalizeContact(phone?: string | null): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return undefined;
  return `+91${digits.slice(-10)}`;
}

/**
 * Reads the signed-in customer's name / mobile / email.
 * `fallbackPhone` is used when the profile has no number (e.g. the pickup
 * contact the customer just typed in the parcel flow).
 */
export async function getPaymentPrefill(
  fallbackPhone?: string | null,
): Promise<PaymentPrefill> {
  let name: string | undefined;
  let phone: string | null | undefined;
  let email: string | undefined;

  try {
    const { data } = await getAuthUser();
    const user = data.user;
    phone = user?.phone ?? null;
    email = user?.email || undefined;

    if (user?.id) {
      const { data: profile } = await supabase
        .from("users")
        .select("full_name, phone")
        .eq("auth_user_id", user.id)
        .maybeSingle();
      if (profile?.full_name) name = profile.full_name;
      if (profile?.phone) phone = profile.phone;
    }
  } catch {
    /* prefill is best-effort — never block a payment */
  }

  const contact = normalizeContact(phone) ?? normalizeContact(fallbackPhone);

  const prefill: PaymentPrefill = {};
  if (name?.trim()) prefill.name = name.trim();
  if (contact) prefill.contact = contact;
  if (email?.trim()) prefill.email = email.trim();
  return prefill;
}
