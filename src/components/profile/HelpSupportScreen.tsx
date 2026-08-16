import { useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  MessageCircle,
  CheckCircle2,
  ShieldCheck,
  ScrollText,
  ReceiptText,
  FileText,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getErrorMessage } from "@/lib/errorMessage";
import { useT } from "@/i18n";
import type { LegalSlug } from "./LegalPageScreen";

const FAQS = [
  {
    q: "How do I book a cleaning?",
    a: "From the Home screen, pick a service, choose Now or Schedule Later, confirm your address, and proceed to payment.",
  },
  {
    q: "Can I reschedule or cancel a booking?",
    a: "You can manage upcoming bookings from My Bookings. Cancellations are free up to 1 hour before the scheduled slot.",
  },
  {
    q: "How do payments work?",
    a: "Payments are handled securely through Razorpay. You'll only be charged after your booking is confirmed.",
  },
  {
    q: "What are Badiyos coins?",
    a: "Coins are rewards earned by completing missions and referring friends. Use them to get discounts on future bookings.",
  },
  {
    q: "How do I contact my expert?",
    a: "Once an expert is assigned, you'll see call and message options on the tracking screen.",
  },
];

export function HelpSupportScreen({
  onBack,
  onOpenLegal,
  onOpenAbout,
}: {
  onBack: () => void;
  onOpenLegal: (slug: LegalSlug) => void;
  onOpenAbout: () => void;
}) {
  const t = useT();
  const legalItems = [
    {
      key: "privacy",
      label: t("legal.privacy"),
      desc: t("legal.privacyDesc"),
      icon: ShieldCheck,
      onClick: () => onOpenLegal("privacy-policy"),
    },
    {
      key: "terms",
      label: t("legal.terms"),
      desc: t("legal.termsDesc"),
      icon: ScrollText,
      onClick: () => onOpenLegal("terms"),
    },
    {
      key: "refund",
      label: t("legal.refund"),
      desc: t("legal.refundDesc"),
      icon: ReceiptText,
      onClick: () => onOpenLegal("refund-policy"),
    },
    {
      key: "about",
      label: "About badiyos",
      desc: "App version, company and contact",
      icon: FileText,
      onClick: onOpenAbout,
    },
  ];
  const [open, setOpen] = useState<number | null>(0);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticketId, setTicketId] = useState<string | null>(null);

  async function handleSubmit() {
    if (!message.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) {
        setError("Please sign in to raise a ticket.");
        return;
      }
      const { data, error } = await supabase
        .from("support_tickets")
        .insert({ user_id: uid, message: message.trim() })
        .select("id")
        .single();
      if (error) throw error;
      setTicketId(data.id);
      setMessage("");
    } catch (e) {
      setError(await getErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen w-full bg-background pb-10">
      <div className="mx-auto w-full max-w-md px-5 pt-6">
        <header className="flex items-center gap-3">
          <button
            onClick={onBack}
            aria-label="Back"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card"
          >
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </button>
          <h1 className="text-lg font-bold text-foreground">Help & Support</h1>
        </header>

        <h2 className="mt-6 text-sm font-bold text-foreground">Frequently Asked Questions</h2>
        <section className="mt-3 divide-y divide-border overflow-hidden rounded-[18px] border border-border bg-card shadow-sm">
          {FAQS.map((f, i) => {
            const isOpen = open === i;
            return (
              <div key={i}>
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full items-center gap-3 px-4 py-4 text-left"
                >
                  <p className="min-w-0 flex-1 text-sm font-bold text-foreground">{f.q}</p>
                  <ChevronDown
                    className={`h-5 w-5 text-muted-foreground transition-transform ${
                      isOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 text-sm text-muted-foreground">{f.a}</div>
                )}
              </div>
            );
          })}
        </section>

        <h2 className="mt-8 text-sm font-bold text-foreground">Raise a ticket</h2>
        {ticketId ? (
          <section className="mt-3 flex flex-col items-center rounded-[18px] border border-border bg-card p-6 text-center shadow-sm">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <CheckCircle2 className="h-7 w-7 text-primary" />
            </div>
            <p className="mt-3 text-base font-bold text-foreground">
              Ticket submitted — we'll get back to you soon
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Ticket ID: {ticketId.slice(0, 8).toUpperCase()}
            </p>
            <button
              onClick={() => setTicketId(null)}
              className="mt-5 text-xs font-semibold text-primary"
            >
              Raise another ticket
            </button>
          </section>
        ) : (
          <section className="mt-3 rounded-[18px] border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
                <MessageCircle className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">Describe your issue</p>
                <p className="text-xs text-muted-foreground">
                  Our team typically responds within a few hours.
                </p>
              </div>
            </div>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              placeholder="Tell us what happened…"
              className="mt-4 w-full resize-none rounded-[14px] border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
            />
            {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
            <button
              onClick={handleSubmit}
              disabled={!message.trim() || submitting}
              className={`mt-3 w-full rounded-[14px] px-4 py-3 text-sm font-bold transition ${
                message.trim() && !submitting
                  ? "bg-primary text-primary-foreground active:scale-[0.99]"
                  : "bg-primary/30 text-primary-foreground/70"
              }`}
            >
              {submitting ? "Submitting…" : "Submit"}
            </button>
          </section>
        )}
      </div>
    </main>
  );
}
