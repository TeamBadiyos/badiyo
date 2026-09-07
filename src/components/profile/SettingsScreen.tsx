import { ArrowLeft, ChevronRight, Globe, Bell, Smartphone, Trash2, X, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useT, useLanguage } from "@/i18n";

export function SettingsScreen({
  onBack,
  onOpenNotifications,
  onOpenDevices,
  onOpenLanguage,
  onAccountDeleted,
}: {
  onBack: () => void;
  onOpenNotifications: () => void;
  onOpenDevices: () => void;
  onOpenLanguage: () => void;
  onAccountDeleted: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const t = useT();
  const { lang } = useLanguage();

  async function handleDeleteAccount() {
    if (deleting) return;
    setDeleting(true);
    try {
      const { error } = await supabase.rpc("customer_delete_account");
      if (error) throw error;
      // Clear the local session so nothing signed-in survives on this device.
      await supabase.auth.signOut();
      try {
        window.localStorage.clear();
        window.sessionStorage.clear();
      } catch {
        /* storage may be unavailable */
      }
      setConfirmDelete(false);
      toast("Your account has been deleted");
      onAccountDeleted();
    } catch (e) {
      console.error("Account deletion failed:", e);
      toast("We couldn't delete your account. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

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
              This removes your profile, saved addresses, rewards access and signs you out of all
              devices. You will not be able to sign in again with this number. Past bookings and
              payment records are kept, without your personal details, because accounting rules
              require us to retain them. This action cannot be undone.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">{t("legal.deleteNote")}</p>
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="flex-1 rounded-[14px] border border-border bg-card py-3 text-sm font-bold text-foreground disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleDeleteAccount()}
                disabled={deleting}
                className="flex flex-1 items-center justify-center gap-2 rounded-[14px] bg-destructive py-3 text-sm font-bold text-destructive-foreground disabled:opacity-60"
              >
                {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
