import { getAuthUser } from "@/lib/authUser";
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
  onOpenTickets,
}: {
  onBack: () => void;
  onOpenLegal: (slug: LegalSlug) => void;
  onOpenAbout: () => void;
  onOpenTickets: () => void;
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

        <h2 className="mt-8 text-sm font-bold text-foreground">{t("legal.section")}</h2>
        <section className="mt-3 divide-y divide-border overflow-hidden rounded-[18px] border border-border bg-card shadow-sm">
          {legalItems.map((it) => (
            <button
              key={it.key}
              onClick={it.onClick}
              className="flex w-full items-center gap-3 px-4 py-4 text-left transition active:bg-muted/40"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
                <it.icon className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-foreground">{it.label}</p>
                <p className="truncate text-xs text-muted-foreground">{it.desc}</p>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </button>
          ))}
        </section>

        <h2 className="mt-8 text-sm font-bold text-foreground">Tickets</h2>
        <button
          onClick={onOpenTickets}
          className="mt-3 flex w-full items-center gap-3 rounded-[18px] border border-border bg-card p-4 text-left shadow-sm transition active:bg-muted/40"
        >
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
            <MessageCircle className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-foreground">My tickets</p>
            <p className="text-xs text-muted-foreground">
              Raise a new ticket or see replies and status updates.
            </p>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </button>

      </div>
    </main>
  );
}
