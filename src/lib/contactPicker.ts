// Pick a contact (name + 10-digit mobile) from the device.
// Native Android uses @capacitor-community/contacts when the plugin is bundled;
// web falls back to the browser Contact Picker API. Permission is asked on tap only.
import { Capacitor, registerPlugin } from "@capacitor/core";

export type PickedContact = { name: string; phone: string };
export type PickResult =
  | { ok: true; contact: PickedContact }
  | { ok: false; reason: "cancelled" | "denied" | "unsupported" | "error" };

type ContactsPlugin = {
  checkPermissions: () => Promise<{ contacts: string }>;
  requestPermissions: () => Promise<{ contacts: string }>;
  pickContact: (options: { projection: { name: boolean; phones: boolean } }) => Promise<{
    contact?: {
      name?: { display?: string | null; given?: string | null } | null;
      phones?: Array<{ number?: string | null }> | null;
    } | null;
  }>;
};

const Contacts = registerPlugin<ContactsPlugin>("Contacts");

function normalisePhone(raw: string | null | undefined): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.slice(-10);
}

export function contactPickerAvailable(): boolean {
  if (Capacitor.isNativePlatform()) return Capacitor.isPluginAvailable("Contacts");
  const nav = navigator as unknown as { contacts?: { select?: unknown } };
  return typeof nav.contacts?.select === "function";
}

export async function pickContact(): Promise<PickResult> {
  try {
    if (Capacitor.isNativePlatform()) {
      if (!Capacitor.isPluginAvailable("Contacts")) return { ok: false, reason: "unsupported" };
      let status = await Contacts.checkPermissions();
      if (status.contacts !== "granted") status = await Contacts.requestPermissions();
      if (status.contacts !== "granted") return { ok: false, reason: "denied" };

      const res = await Contacts.pickContact({ projection: { name: true, phones: true } });
      const contact = res?.contact;
      if (!contact) return { ok: false, reason: "cancelled" };
      const phone = normalisePhone(contact.phones?.find((p) => p?.number)?.number);
      const name = (contact.name?.display || contact.name?.given || "").trim();
      return { ok: true, contact: { name, phone } };
    }

    const nav = navigator as unknown as {
      contacts?: { select?: (props: string[], opts?: { multiple?: boolean }) => Promise<unknown[]> };
    };
    if (typeof nav.contacts?.select !== "function") return { ok: false, reason: "unsupported" };
    const picked = (await nav.contacts.select(["name", "tel"], { multiple: false })) as Array<{
      name?: string[];
      tel?: string[];
    }>;
    if (!picked?.length) return { ok: false, reason: "cancelled" };
    return {
      ok: true,
      contact: {
        name: (picked[0]?.name?.[0] ?? "").trim(),
        phone: normalisePhone(picked[0]?.tel?.[0]),
      },
    };
  } catch (error) {
    const message = String((error as Error)?.message ?? "").toLowerCase();
    if (message.includes("cancel")) return { ok: false, reason: "cancelled" };
    if (message.includes("permission") || message.includes("denied")) return { ok: false, reason: "denied" };
    if (message.includes("not implemented") || message.includes("unavailable")) {
      return { ok: false, reason: "unsupported" };
    }
    return { ok: false, reason: "error" };
  }
}
