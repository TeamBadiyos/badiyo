import {
  ArrowLeft,
  ChevronRight,
  CalendarCheck,
  Wallet as WalletIcon,
  User,
  UserCog,
  Bell,
  Settings as SettingsIcon,
  HelpCircle,
  Gift,
  LogOut,
  CreditCard,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAvatarUrl } from "@/lib/useAvatarUrl";
import { useT } from "@/i18n";



type Item = { key: string; label: string; desc: string; icon: LucideIcon; onClick: () => void };
type Group = { title: string; items: Item[] };

export function ProfileScreen({
  onBack,
  onOpenBookings,
  onOpenWallet,
  onOpenEditProfile,
  onOpenNotifications,
  onOpenSettings,
  onOpenHelp,
  onOpenAbout,
  onOpenReferrals,
  onOpenPaymentMethods,
  onOpenLegal,
  onLogout,
}: {
  onBack: () => void;
  onOpenBookings: () => void;
  onOpenWallet: () => void;
  onOpenEditProfile: () => void;
  onOpenNotifications: () => void;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
  onOpenAbout: () => void;
  onOpenReferrals: () => void;
  onOpenPaymentMethods: () => void;
  onOpenLegal: (slug: LegalSlug) => void;
  onLogout: () => void;
}) {

  const [fullName, setFullName] = useState<string | null>(null);
  const { data: avatarUrl } = useAvatarUrl();
  const t = useT();

  useEffect(() => {
    (async () => {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) return;
      const { data } = await supabase
        .from("users")
        .select("full_name")
        .eq("id", uid)
        .single();
      if (data?.full_name) setFullName(data.full_name);
    })();
  }, []);



  async function handleLogout() {
    await supabase.auth.signOut();
    onLogout();
  }

  const groups: Group[] = [
    {
      title: "Account",
      items: [
        { key: "edit", label: "Edit Profile", desc: "Name, email and avatar", icon: UserCog, onClick: onOpenEditProfile },
        { key: "payment", label: "Payment Methods", desc: "UPI, cards & saved methods", icon: CreditCard, onClick: onOpenPaymentMethods },
      ],
    },

    {
      title: "Activity",
      items: [
        { key: "bookings", label: "My Bookings", desc: "View past and upcoming services", icon: CalendarCheck, onClick: onOpenBookings },
        { key: "wallet", label: "Wallet", desc: "Badiyos coins & transactions", icon: WalletIcon, onClick: onOpenWallet },
        { key: "referrals", label: "Refer & Earn", desc: "Invite friends and earn rewards", icon: Gift, onClick: onOpenReferrals },
      ],
    },
    {
      title: "Preferences",
      items: [
        { key: "notif", label: "Notifications", desc: "Manage what you get pinged about", icon: Bell, onClick: onOpenNotifications },
        { key: "settings", label: "Settings", desc: "Language, privacy and account", icon: SettingsIcon, onClick: onOpenSettings },
      ],
    },
    {
      title: "Support",
      items: [
        {
          key: "help",
          label: "Help & Support",
          desc: `FAQs, contact us & ${t("legal.section").toLowerCase()}`,
          icon: HelpCircle,
          onClick: onOpenHelp,
        },
      ],
    },
  ];

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
          <h1 className="text-lg font-bold text-foreground">Profile</h1>
        </header>

        <section className="mt-6 flex items-center gap-4 rounded-[18px] border border-border bg-card p-4 shadow-sm">
          <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border-2 border-primary/60 bg-primary/10">
            {avatarUrl ? (
              <img src={avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
            ) : (
              <User className="h-7 w-7 text-primary" />
            )}
          </div>

          <div className="min-w-0">
            <p className="text-base font-bold text-foreground">{fullName ? `Hello, ${fullName}!` : "Hello!"}</p>
            <p className="text-xs text-muted-foreground">Manage your bookings and rewards</p>
          </div>
        </section>

        {groups.map((g) => (
          <section key={g.title} className="mt-6">
            <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              {g.title}
            </h2>
            <div className="space-y-2">
              {g.items.map((it) => (
                <button
                  key={it.key}
                  onClick={it.onClick}
                  className="flex w-full items-center gap-3 rounded-[14px] border border-border bg-card px-4 py-3 text-left transition active:scale-[0.99]"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                    <it.icon className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-foreground">{it.label}</p>
                    <p className="text-xs text-muted-foreground">{it.desc}</p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground" />
                </button>
              ))}
            </div>
          </section>
        ))}

        <button
          onClick={handleLogout}
          className="mt-4 flex w-full items-center gap-3 rounded-[14px] border border-destructive/30 bg-card px-4 py-3 text-left transition active:scale-[0.99]"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
            <LogOut className="h-5 w-5 text-destructive" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-destructive">Logout</p>
            <p className="text-xs text-muted-foreground">Sign out of your account</p>
          </div>
        </button>
      </div>
    </main>
  );
}
