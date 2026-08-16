import { ArrowLeft, ChevronRight, Globe, Bell, Smartphone, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useT, useLanguage } from "@/i18n";

export function SettingsScreen({
  onBack,
  onOpenNotifications,
  onOpenDevices,
  onOpenLanguage,
}: {
  onBack: () => void;
  onOpenNotifications: () => void;
  onOpenDevices: () => void;
  onOpenLanguage: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const t = useT();
  const { lang } = useLanguage();

  const items = [
    {
      key: "lang",
      label: t("settings.language"),
      value: lang === "mr" ? t("language.marathi") : t("language.english"),
      icon: Globe,
      onClick: onOpenLanguage,
    },
    { key: "notif", label: t("settings.notifications"), icon: Bell, onClick: onOpenNotifications },
    { key: "devices", label: t("settings.devices"), icon: Smartphone, onClick: onOpenDevices },
  ];

  const legalItems = [
    { key: "privacy", label: t("legal.privacy"), icon: Shield, onClick: () => onOpenLegal("privacy-policy") },
    { key: "terms", label: t("legal.terms"), icon: ScrollText, onClick: () => onOpenLegal("terms") },
    { key: "refund", label: t("legal.refund"), icon: ReceiptText, onClick: () => onOpenLegal("refund-policy") },
    { key: "about", label: "About badiyos", icon: Bell, onClick: onOpenAbout },
  ];

  return (
    <main className="min-h-screen w-full bg-background pb-10">
      <div className="mx-auto w-full max-w-md px-5 pt-6">
        <header className="flex items-center gap-3">
          <button
            onClick={onBack}
            aria-label={t("common.back")}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card"
          >
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </button>
          <h1 className="text-lg font-bold text-foreground">{t("settings.title")}</h1>
        </header>

        <section className="mt-6 divide-y divide-border overflow-hidden rounded-[18px] border border-border bg-card shadow-sm">
          {items.map((it) => (
            <button
              key={it.key}
              onClick={it.onClick}
              className="flex w-full items-center gap-3 px-4 py-4 text-left transition active:bg-muted/40"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
                <it.icon className="h-4 w-4 text-primary" />
              </div>
              <p className="min-w-0 flex-1 text-sm font-bold text-foreground">{it.label}</p>
              {it.value && <span className="text-xs text-muted-foreground">{it.value}</span>}
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </button>
          ))}
        </section>

        <h2 className="mt-8 mb-2 px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          {t("legal.section")}
        </h2>
        <section className="divide-y divide-border overflow-hidden rounded-[18px] border border-border bg-card shadow-sm">
          {legalItems.map((it) => (
            <button
              key={it.key}
              onClick={it.onClick}
              className="flex w-full items-center gap-3 px-4 py-4 text-left transition active:bg-muted/40"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
                <it.icon className="h-4 w-4 text-primary" />
              </div>
              <p className="min-w-0 flex-1 text-sm font-bold text-foreground">{it.label}</p>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </button>
          ))}
        </section>

        <button
          onClick={() => setConfirmDelete(true)}
          className="mt-6 flex w-full items-center gap-3 rounded-[14px] border border-destructive/30 bg-card px-4 py-4 text-left"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-destructive/10">
            <Trash2 className="h-4 w-4 text-destructive" />
          </div>
          <p className="flex-1 text-sm font-bold text-destructive">Delete Account</p>
        </button>
      </div>

      {confirmDelete && (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/40 sm:items-center">
          <div className="w-full max-w-md rounded-t-[20px] bg-card p-5 sm:rounded-[20px]">
            <div className="flex items-start justify-between">
              <h2 className="text-base font-bold text-foreground">Delete your account?</h2>
              <button
                onClick={() => setConfirmDelete(false)}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              This will permanently remove your profile, bookings, and rewards. This action cannot be undone.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {t("legal.deleteNote")}{" "}
              <button
                type="button"
                onClick={() => { setConfirmDelete(false); onOpenLegal("refund-policy"); }}
                className="font-semibold text-primary underline underline-offset-2"
              >
                {t("legal.refund")}
              </button>
              {" · "}
              <button
                type="button"
                onClick={() => { setConfirmDelete(false); onOpenLegal("privacy-policy"); }}
                className="font-semibold text-primary underline underline-offset-2"
              >
                {t("legal.privacy")}
              </button>
            </p>
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => setConfirmDelete(false)}
                className="flex-1 rounded-[14px] border border-border bg-card py-3 text-sm font-bold text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="flex-1 rounded-[14px] bg-destructive py-3 text-sm font-bold text-destructive-foreground"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
