import { useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  MessageCircle,
  ShieldCheck,
  ScrollText,
  ReceiptText,
  FileText,
} from "lucide-react";
import { useLanguage, useT } from "@/i18n";
import type { LegalSlug } from "./LegalPageScreen";

const FAQS = [
  {
    q: "How do I book a cleaning?", q_mr: "स्वच्छता कशी बुक करायची?",
    a: "From the Home screen, pick a service, choose Now or Schedule Later, confirm your address, and proceed to payment.",
    a_mr: "होम स्क्रीनवर सेवा निवडा, आत्ता किंवा नंतरची वेळ निवडा, पत्ता पक्का करा आणि पेमेंट करा.",
  },
  {
    q: "Can I reschedule or cancel a booking?", q_mr: "बुकिंगची वेळ बदलता किंवा रद्द करता येते का?",
    a: "You can manage upcoming bookings from My Bookings. Tap Cancellation policy on a booking to see fees and refunds.",
    a_mr: "माझी बुकिंग्स मधून पुढील बुकिंग्स सांभाळा. शुल्क आणि परतावा पाहण्यासाठी बुकिंगवर रद्द करण्याचे धोरण दाबा.",
  },
  {
    q: "How do payments work?", q_mr: "पेमेंट कसे होते?",
    a: "Payments are handled securely through Razorpay, or from your badiyos Wallet when it covers the total.",
    a_mr: "पेमेंट Razorpay द्वारे सुरक्षितपणे होते, किंवा वॉलेटमध्ये पुरेशी रक्कम असल्यास badiyos वॉलेटमधून.",
  },
  {
    q: "What is badiyos Wallet?", q_mr: "badiyos वॉलेट म्हणजे काय?",
    a: "Your badiyos Wallet holds rewards, referral money and refunds. Use it on future bookings.",
    a_mr: "तुमच्या badiyos वॉलेटमध्ये रिवॉर्ड्स, रेफरलचे पैसे आणि परतावा जमा होतो. पुढच्या बुकिंगवर वापरा.",
  },
  {
    q: "How do I contact my expert?", q_mr: "एक्सपर्टशी संपर्क कसा करायचा?",
    a: "Once an expert is assigned, you'll see call and message options on the tracking screen.",
    a_mr: "एक्सपर्ट नेमल्यावर ट्रॅकिंग स्क्रीनवर कॉल आणि मेसेजचे पर्याय दिसतील.",
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
  const { lang } = useLanguage();
  const tr = (en: string, mr: string) => (lang === "mr" ? mr : en);
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
      label: tr("About badiyos", "badiyos बद्दल"),
      desc: tr("App version, company and contact", "ॲप आवृत्ती, कंपनी आणि संपर्क"),
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
          <h1 className="text-lg font-bold text-foreground">{tr("Help & Support", "मदत आणि सपोर्ट")}</h1>
        </header>

        <h2 className="mt-6 text-sm font-bold text-foreground">{tr("Frequently Asked Questions", "नेहमी विचारले जाणारे प्रश्न")}</h2>
        <section className="mt-3 divide-y divide-border overflow-hidden rounded-[18px] border border-border bg-card shadow-sm">
          {FAQS.map((f, i) => {
            const isOpen = open === i;
            return (
              <div key={i}>
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full items-center gap-3 px-4 py-4 text-left"
                >
                  <p className="min-w-0 flex-1 text-sm font-bold text-foreground">{tr(f.q, f.q_mr)}</p>
                  <ChevronDown
                    className={`h-5 w-5 text-muted-foreground transition-transform ${
                      isOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 text-sm text-muted-foreground">{tr(f.a, f.a_mr)}</div>
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

        <h2 className="mt-8 text-sm font-bold text-foreground">{tr("Tickets", "तिकिटे")}</h2>
        <button
          onClick={onOpenTickets}
          className="mt-3 flex w-full items-center gap-3 rounded-[18px] border border-border bg-card p-4 text-left shadow-sm transition active:bg-muted/40"
        >
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
            <MessageCircle className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-foreground">{tr("My tickets", "माझी तिकिटे")}</p>
            <p className="text-xs text-muted-foreground">
              {tr("Raise a new ticket or see replies and status updates.", "नवीन तिकीट उघडा किंवा उत्तरे व स्थिती पहा.")}
            </p>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </button>

      </div>
    </main>
  );
}
