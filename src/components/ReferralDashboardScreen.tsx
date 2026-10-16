import { getAuthUser } from "@/lib/authUser";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Copy,
  Gift,
  Link2,
  QrCode,
  Share2,
  MessageCircle,
  X,
  Check,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ReferralCodeInput } from "@/components/ReferralCodeInput";
import { fetchReferralProgress } from "@/lib/coupons";
import { toast } from "sonner";
import { useLanguage } from "@/i18n";
import { readLangOutsideReact } from "@/lib/catalogI18n";


import { buildPlayStoreInviteUrl, buildReferralShareMessage } from "@/lib/referrals";


type Txn = {
  id: string;
  status: string;
  reward_amount: number | null;
  signup_reward_amount: number | null;
  booking_reward_amount: number | null;
  created_at: string;
  referred_user_id: string | null;
  referred_name?: string | null;
};

type UserRow = {
  full_name: string | null;
  referral_code: string | null;
  total_coins_earned: number | null;
  referred_by: string | null;
};

type ReferralConfigRow = {
  milestone_referrals: number | null;
  milestone_reward_coins: number | null;
  reward_coins: number | null;
  signup_reward_coins: number | null;
  booking_reward_coins: number | null;
};

const L = (en: string, mr: string) => (readLangOutsideReact() === "mr" ? mr : en);
const STATUS_META: Record<string, { label: string; className: string }> = {
  pending: { label: L("Pending", "बाकी"), className: "bg-muted text-muted-foreground" },
  registered: { label: L("Joined", "जॉइन झाले"), className: "bg-blue-100 text-blue-700" },
  first_booking_completed: {
    label: L("First Booking", "पहिले बुकिंग"),
    className: "bg-orange-100 text-orange-700",
  },
  reward_credited: {
    label: L("Fully Rewarded", "पूर्ण रिवॉर्ड"),
    className: "bg-primary/15 text-primary",
  },
  reversed: { label: L("Reversed", "परत घेतले"), className: "bg-muted text-muted-foreground" },
};

function txnEarned(t: Txn) {
  const staged =
    Number(t.signup_reward_amount ?? 0) + Number(t.booking_reward_amount ?? 0);
  return staged > 0 ? staged : Number(t.reward_amount ?? 0);
}

function statusMeta(status: string) {
  return (
    STATUS_META[status] ?? {
      label: status.replace(/_/g, " "),
      className: "bg-muted text-muted-foreground",
    }
  );
}

async function fetchAll() {
  const { data: userData } = await getAuthUser();
  const uid = userData.user?.id;
  if (!uid) throw new Error("Not signed in");

  const [userRes, txnRes, cfgRes] = await Promise.all([
    supabase
      .from("users")
      .select("full_name, referral_code, total_coins_earned, referred_by")
      .eq("id", uid)
      .maybeSingle(),
    supabase.rpc("my_referral_history"),
    supabase
      .from("referral_config")
      .select(
        "milestone_referrals, milestone_reward_coins, reward_coins, signup_reward_coins, booking_reward_coins",
      )
      .eq("is_active", true)
      .maybeSingle(),
  ]);

  if (userRes.error) throw userRes.error;
  if (txnRes.error) throw txnRes.error;
  if (cfgRes.error) throw cfgRes.error;

  return {
    user: (userRes.data ?? null) as UserRow | null,
    transactions: (txnRes.data ?? []) as Txn[],
    config: (cfgRes.data ?? null) as ReferralConfigRow | null,
  };
}

function friendLabel(t: Txn) {
  const name = t.referred_name?.trim();
  if (name) return name;
  return L("Friend", "मित्र");
}

function initialsFor(t: Txn) {
  const name = t.referred_name?.trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    const letters =
      parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}` : parts[0].slice(0, 2);
    return letters.toUpperCase();
  }
  return t.referred_user_id ? t.referred_user_id.slice(0, 2).toUpperCase() : "?";
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex-1 rounded-[18px] border border-border bg-card p-4">
      <div className="text-xs font-semibold text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-extrabold text-foreground">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function QrModal({ url, onClose }: { url: string; onClose: () => void }) {
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(url)}`;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="mx-auto w-full max-w-md rounded-t-[24px] bg-card p-6 pb-[calc(var(--app-safe-bottom)+24px)] sm:rounded-[24px] sm:pb-8">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-extrabold text-foreground">{L("Your invite QR", "तुमचा आमंत्रण QR")}</h3>
          <button
            aria-label="Close"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-muted"
          >
            <X className="h-4 w-4 text-foreground" />
          </button>
        </div>
        <div className="mt-5 flex flex-col items-center">
          <div className="rounded-[18px] border border-border bg-white p-4">
            <img src={qrSrc} alt="Referral QR code" width={280} height={280} />
          </div>
          <p className="mt-4 break-all text-center text-xs text-muted-foreground">{url}</p>
        </div>
      </div>
    </div>
  );
}

export function ReferralDashboardScreen({ onBack }: { onBack: () => void }) {
  const { lang } = useLanguage();
  const tr = (en: string, mr: string) => (lang === "mr" ? mr : en);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["referral-dashboard"],
    queryFn: fetchAll,
  });

  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [qrOpen, setQrOpen] = useState(false);

  const transactions = data?.transactions ?? [];
  const user = data?.user ?? null;
  const config = data?.config ?? null;

  // Qualified = the friend has completed their first booking (reward credited or pending credit).
  const successful = useMemo(
    () =>
      transactions.filter(
        (t) => t.status === "reward_credited" || t.status === "first_booking_completed",
      ),
    [transactions],
  );
  const { data: progress } = useQuery({
    queryKey: ["referral_progress"],
    queryFn: fetchReferralProgress,
    staleTime: 60_000,
  });
  const invitedCount = progress?.invited ?? transactions.length;
  const joinedCount = progress?.joined ?? transactions.length;
  const qualifiedCount = progress?.qualified ?? successful.length;
  const totalRewards = useMemo(
    () => transactions.reduce((sum, t) => sum + txnEarned(t), 0),
    [transactions],
  );
  const signupReward = Number(config?.signup_reward_coins ?? 10);
  const bookingReward = Number(config?.booking_reward_coins ?? 20);
  const totalPerReferral =
    Number(config?.reward_coins ?? signupReward + bookingReward) ||
    signupReward + bookingReward;
  const familiesHelped = successful.length;
  const totalReferred = transactions.length;
  const walletBalance = user?.total_coins_earned ?? 0;

  const code = user?.referral_code ?? "";
  const inviteUrl = code
    ? buildPlayStoreInviteUrl(code)
    : buildPlayStoreInviteUrl("");
  const shareText = buildReferralShareMessage(code);


  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  async function copyText(text: string, tag: "code" | "link") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(tag);
    } catch {
      // ignore
    }
  }

  function openWhatsApp() {
    const url = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function nativeShare() {
    // On Capacitor native, use the plugin — WebView navigator.share is
    // unreliable on Android and often silently unavailable.
    try {
      const { Capacitor } = await import("@capacitor/core");
      if (Capacitor.isNativePlatform()) {
        const { Share } = await import("@capacitor/share");
        // Only `text` — passing `url` too makes the link appear twice.
        await Share.share({ text: shareText, dialogTitle: tr("Share badiyos", "badiyos शेअर करा") });
        return;
      }
    } catch {
      // fall through to web share / clipboard
    }

    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ text: shareText });
        return;
      } catch (e) {
        // User cancelled — don't fall back to copy.
        if ((e as DOMException)?.name === "AbortError") return;
      }
    }

    try {
      await navigator.clipboard.writeText(shareText);
      toast.success(tr("Invite link copied to clipboard", "आमंत्रण लिंक कॉपी झाली"));
    } catch {
      toast.error(tr("Could not share or copy the link", "लिंक शेअर किंवा कॉपी करता आली नाही"));
    }
  }


  return (
    <main className="min-h-screen w-full bg-background pb-14">
      <div className="mx-auto w-full max-w-md px-5 pt-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            aria-label="Back"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card"
          >
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </button>
          <h1 className="text-base font-bold text-foreground">{tr("Refer & Earn", "रेफर करा आणि कमवा")}</h1>
        </div>

        {isLoading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">{tr("Loading…", "लोड होत आहे…")}</div>
        ) : error ? (
          <div className="py-16 text-center text-sm text-destructive">
            {tr("Could not load referral data", "रेफरल माहिती लोड झाली नाही")}
          </div>
        ) : (
          <>
            {/* Headline card */}
            <section className="mt-6 rounded-[18px] bg-primary/10 p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/20">
                  <Gift className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-base font-extrabold leading-snug text-foreground">
                    {tr(`You've helped ${familiesHelped} ${familiesHelped === 1 ? "family" : "families"} discover badiyos`, `तुम्ही ${familiesHelped} कुटुंबांना badiyos ची ओळख करून दिली`)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {tr("Keep sharing to earn more rewards", "आणखी रिवॉर्ड्ससाठी शेअर करत रहा")}
                  </p>
                </div>
              </div>
            </section>

            {/* Stat grid */}
            <section className="mt-4 grid grid-cols-2 gap-3">
              <StatCard label={tr("Total Rewards Earned", "एकूण मिळालेले रिवॉर्ड्स")} value={`₹${totalRewards}`} />
              <StatCard label={tr("Wallet Balance", "वॉलेट शिल्लक")} value={`₹${walletBalance}`} />
              <StatCard label={tr("Families Referred", "रेफर केलेली कुटुंबे")} value={String(totalReferred)} />
              <StatCard label={tr("Successful Referrals", "यशस्वी रेफरल्स")} value={String(successful.length)} />
            </section>

            {/* How rewards work */}
            <section className="mt-4 rounded-[18px] border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-foreground">
                  {tr(`Earn ₹${totalPerReferral} in badiyos Wallet per friend`, `प्रत्येक मित्रामागे badiyos वॉलेटमध्ये ₹${totalPerReferral} कमवा`)}
                </h2>
                <span className="rounded-full bg-primary/15 px-2.5 py-1 text-[11px] font-extrabold text-primary">
                  {tr("Added to your badiyos Wallet", "तुमच्या badiyos वॉलेटमध्ये जमा")}
                </span>
              </div>
              <div className="mt-3 space-y-2">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[11px] font-extrabold text-blue-700">
                    1
                  </span>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-bold text-foreground">
                      ₹{signupReward}
                    </span>{" "}
                    {tr("as soon as your friend joins badiyos with your code.", "तुमचा मित्र तुमच्या कोडने badiyos जॉइन करताच.")}
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-extrabold text-primary">
                    2
                  </span>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-bold text-foreground">
                      ₹{bookingReward}
                    </span>{" "}
                    {tr("when they complete their first booking.", "त्यांचे पहिले बुकिंग पूर्ण झाल्यावर.")}
                  </p>
                </div>
              </div>
              <p className="mt-3 rounded-[12px] bg-muted/60 p-3 text-xs text-muted-foreground">
                <span className="font-bold text-foreground">{tr("Rewards go to your badiyos Wallet.", "रिवॉर्ड्स तुमच्या badiyos वॉलेटमध्ये जमा होतात.")}</span>{" "}
                {tr(`That is ₹${totalPerReferral} per friend. Use your wallet balance at checkout to pay less on any booking.`, `म्हणजे प्रत्येक मित्रामागे ₹${totalPerReferral}. चेकआउटवर वॉलेट शिल्लक वापरून कोणत्याही बुकिंगवर कमी पैसे भरा.`)}
              </p>
            </section>

            {/* Apply a friend's code */}
            <section className="mt-6">
              <h2 className="text-sm font-bold text-foreground">{tr("Enter a friend's code", "मित्राचा कोड टाका")}</h2>
              <ReferralCodeInput
                className="mt-3"
                alreadyReferred={!!user?.referred_by}
                onApplied={() => void refetch()}
              />
            </section>

            {/* Referral code */}
            <section className="mt-6">
              <h2 className="text-sm font-bold text-foreground">{tr("Your referral code", "तुमचा रेफरल कोड")}</h2>
              <div className="mt-3 flex items-center gap-3 rounded-[18px] border border-dashed border-primary/50 bg-primary/5 p-4">
                <div className="flex-1 truncate text-2xl font-extrabold tracking-wider text-primary">
                  {code || "—"}
                </div>
                <button
                  disabled={!code}
                  onClick={() => copyText(code, "code")}
                  className="flex items-center gap-1.5 rounded-[12px] bg-primary px-3 py-2 text-sm font-bold text-primary-foreground transition active:scale-[0.98] disabled:opacity-50"
                >
                  {copied === "code" ? (
                    <>
                      <Check className="h-4 w-4" /> {tr("Copied", "कॉपी झाले")}
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" /> {tr("Copy", "कॉपी")}
                    </>
                  )}
                </button>
              </div>
            </section>

            {/* Share options */}
            <section className="mt-6">
              <h2 className="text-sm font-bold text-foreground">{tr("Share with friends", "मित्रांसोबत शेअर करा")}</h2>
              <div className="mt-3 grid grid-cols-4 gap-2">
                <ShareBtn
                  icon={<MessageCircle className="h-5 w-5" />}
                  label="WhatsApp"
                  onClick={openWhatsApp}
                />
                <ShareBtn
                  icon={
                    copied === "link" ? (
                      <Check className="h-5 w-5" />
                    ) : (
                      <Link2 className="h-5 w-5" />
                    )
                  }
                  label={copied === "link" ? tr("Copied", "कॉपी झाले") : tr("Copy Link", "लिंक कॉपी")}
                  onClick={() => copyText(inviteUrl, "link")}
                />
                <ShareBtn
                  icon={<Share2 className="h-5 w-5" />}
                  label={tr("Share", "शेअर")}
                  onClick={nativeShare}
                />
                <ShareBtn
                  icon={<QrCode className="h-5 w-5" />}
                  label="QR Code"
                  onClick={() => setQrOpen(true)}
                />
              </div>
            </section>

            {/* Referral progress */}
            <section className="mt-6 grid grid-cols-3 gap-2">
              {[
                { label: tr("Invited", "आमंत्रित"), value: invitedCount },
                { label: tr("Joined", "जॉइन झाले"), value: joinedCount },
                { label: tr("Qualified", "पात्र"), value: qualifiedCount },
              ].map((s) => (
                <div
                  key={s.label}
                  className="rounded-[16px] border border-border bg-card p-3 text-center"
                >
                  <p className="text-xl font-extrabold text-foreground">{s.value}</p>
                  <p className="mt-0.5 text-[11px] font-semibold text-muted-foreground">
                    {s.label}
                  </p>
                </div>
              ))}
            </section>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {tr(`You get ₹${signupReward} when a friend joins, and ₹${bookingReward} more once they complete their first booking.`, `मित्र जॉइन झाल्यावर ₹${signupReward} आणि त्यांचे पहिले बुकिंग पूर्ण झाल्यावर आणखी ₹${bookingReward} मिळतील.`)}
            </p>


            {/* Referral history */}
            <section className="mt-8">
              <h2 className="text-sm font-bold text-foreground">{tr("Referral History", "रेफरल इतिहास")}</h2>
              {transactions.length === 0 ? (
                <div className="mt-3 rounded-[18px] border border-dashed border-border bg-card p-6 text-center">
                  <p className="text-sm font-semibold text-foreground">
                    {tr("No referrals yet", "अजून रेफरल नाहीत")}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {tr("Start sharing your code!", "तुमचा कोड शेअर करायला सुरुवात करा!")}
                  </p>
                </div>
              ) : (
                <ul className="mt-3 space-y-2">
                  {transactions.map((t) => {
                    const meta = statusMeta(t.status);
                    const earned = txnEarned(t);
                    const pending = Math.max(totalPerReferral - earned, 0);
                    const date = new Date(t.created_at).toLocaleDateString(undefined, {
                      day: "numeric",
                      month: "short",
                    });
                    return (
                      <li
                        key={t.id}
                        className="flex items-center gap-3 rounded-[16px] border border-border bg-card p-3"
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-extrabold text-primary">
                          {initialsFor(t)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-bold text-foreground">
                            {friendLabel(t)}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {date} · ₹{earned} {tr("earned", "मिळाले")}
                            {pending > 0 && t.status !== "reversed"
                              ? tr(` · ₹${pending} after first booking`, ` · पहिल्या बुकिंगनंतर ₹${pending}`)
                              : ""}
                          </div>
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${meta.className}`}
                        >
                          {meta.label}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}
      </div>

      {qrOpen && <QrModal url={inviteUrl} onClose={() => setQrOpen(false)} />}
    </main>
  );
}

function ShareBtn({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 rounded-[16px] border border-border bg-card px-2 py-3 text-foreground transition active:scale-[0.98]"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
        {icon}
      </span>
      <span className="text-[11px] font-semibold">{label}</span>
    </button>
  );
}
