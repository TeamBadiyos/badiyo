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
import { toast } from "sonner";


/** Public web address of the customer app — invite links must land here. */
const INVITE_BASE_URL = "https://user.badiyos.com";

type Txn = {
  id: string;
  status: string;
  reward_amount: number | null;
  created_at: string;
  referred_user_id: string | null;
};

type UserRow = {
  full_name: string | null;
  referral_code: string | null;
  total_coins_earned: number | null;
};

type ReferralConfigRow = {
  milestone_referrals: number | null;
  milestone_reward_coins: number | null;
  reward_coins: number | null;
};

const STATUS_META: Record<string, { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-muted text-muted-foreground" },
  registered: { label: "Registered", className: "bg-blue-100 text-blue-700" },
  first_booking_completed: {
    label: "First Booking",
    className: "bg-orange-100 text-orange-700",
  },
  reward_credited: {
    label: "Reward Credited",
    className: "bg-primary/15 text-primary",
  },
};

function statusMeta(status: string) {
  return (
    STATUS_META[status] ?? {
      label: status.replace(/_/g, " "),
      className: "bg-muted text-muted-foreground",
    }
  );
}

async function fetchAll() {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) throw new Error("Not signed in");

  const [userRes, txnRes, cfgRes] = await Promise.all([
    supabase
      .from("users")
      .select("full_name, referral_code, total_coins_earned")
      .eq("id", uid)
      .maybeSingle(),
    supabase
      .from("referral_transactions")
      .select("id, status, reward_amount, created_at, referred_user_id")
      .eq("referrer_id", uid)
      .order("created_at", { ascending: false }),
    supabase
      .from("referral_config")
      .select("milestone_referrals, milestone_reward_coins, reward_coins")
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

function initialsFor(id: string | null | undefined) {
  if (!id) return "?";
  return id.slice(0, 2).toUpperCase();
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
      <div className="mx-auto w-full max-w-md rounded-t-[24px] bg-card p-6 pb-8 sm:rounded-[24px]">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-extrabold text-foreground">Your invite QR</h3>
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
  const { data, isLoading, error } = useQuery({
    queryKey: ["referral-dashboard"],
    queryFn: fetchAll,
  });

  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [qrOpen, setQrOpen] = useState(false);

  const transactions = data?.transactions ?? [];
  const user = data?.user ?? null;
  const config = data?.config ?? null;

  const successful = useMemo(
    () => transactions.filter((t) => t.status === "reward_credited"),
    [transactions],
  );
  const totalRewards = useMemo(
    () => successful.reduce((sum, t) => sum + Number(t.reward_amount ?? 0), 0),
    [successful],
  );
  const familiesHelped = successful.length;
  const totalReferred = transactions.length;
  const walletBalance = user?.total_coins_earned ?? 0;

  const code = user?.referral_code ?? "";
  const inviteUrl = code ? `${INVITE_BASE_URL}/invite/${code}` : INVITE_BASE_URL;
  const shareText = code
    ? `Join badiyos and get trusted home cleaning! Use my code ${code}: ${inviteUrl}`
    : `Join badiyos and get trusted home cleaning! ${inviteUrl}`;

  const milestone = Number(config?.milestone_referrals ?? 5) || 5;
  const progressCount = Math.min(successful.length, milestone);
  const progressPct = Math.min(100, Math.round((progressCount / milestone) * 100));
  const remaining = Math.max(0, milestone - successful.length);

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
        await Share.share({ title: "badiyos", text: shareText, url: inviteUrl, dialogTitle: "Share badiyos" });
        return;
      }
    } catch {
      // fall through to web share / clipboard
    }

    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "badiyos", text: shareText, url: inviteUrl });
        return;
      } catch (e) {
        // User cancelled — don't fall back to copy.
        if ((e as DOMException)?.name === "AbortError") return;
      }
    }

    try {
      await navigator.clipboard.writeText(shareText);
      toast.success("Invite link copied to clipboard");
    } catch {
      toast.error("Could not share or copy the link");
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
          <h1 className="text-base font-bold text-foreground">Refer & Earn</h1>
        </div>

        {isLoading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
        ) : error ? (
          <div className="py-16 text-center text-sm text-destructive">
            Could not load referral data
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
                    You&apos;ve helped {familiesHelped}{" "}
                    {familiesHelped === 1 ? "family" : "families"} discover badiyos
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Keep sharing to earn more rewards
                  </p>
                </div>
              </div>
            </section>

            {/* Stat grid */}
            <section className="mt-4 grid grid-cols-2 gap-3">
              <StatCard label="Total Rewards Earned" value={`Rs ${totalRewards}`} />
              <StatCard label="Wallet Balance" value={`${walletBalance} coins`} />
              <StatCard label="Families Referred" value={String(totalReferred)} />
              <StatCard label="Successful Referrals" value={String(successful.length)} />
            </section>

            {/* Referral code */}
            <section className="mt-6">
              <h2 className="text-sm font-bold text-foreground">Your referral code</h2>
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
                      <Check className="h-4 w-4" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" /> Copy
                    </>
                  )}
                </button>
              </div>
            </section>

            {/* Share options */}
            <section className="mt-6">
              <h2 className="text-sm font-bold text-foreground">Share with friends</h2>
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
                  label={copied === "link" ? "Copied" : "Copy Link"}
                  onClick={() => copyText(inviteUrl, "link")}
                />
                <ShareBtn
                  icon={<Share2 className="h-5 w-5" />}
                  label="Share"
                  onClick={nativeShare}
                />
                <ShareBtn
                  icon={<QrCode className="h-5 w-5" />}
                  label="QR Code"
                  onClick={() => setQrOpen(true)}
                />
              </div>
            </section>

            {/* Milestone */}
            <section className="mt-8 rounded-[18px] border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-foreground">Milestone</h2>
                <span className="text-xs font-semibold text-muted-foreground">
                  {progressCount} of {milestone}
                </span>
              </div>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {remaining > 0
                  ? `Refer ${remaining} more to unlock a bonus reward of ${config?.milestone_reward_coins ?? 0} coins`
                  : "You've unlocked the bonus reward — amazing!"}
              </p>
            </section>

            {/* Referral history */}
            <section className="mt-8">
              <h2 className="text-sm font-bold text-foreground">Referral History</h2>
              {transactions.length === 0 ? (
                <div className="mt-3 rounded-[18px] border border-dashed border-border bg-card p-6 text-center">
                  <p className="text-sm font-semibold text-foreground">
                    No referrals yet
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Start sharing your code!
                  </p>
                </div>
              ) : (
                <ul className="mt-3 space-y-2">
                  {transactions.map((t) => {
                    const meta = statusMeta(t.status);
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
                          {initialsFor(t.referred_user_id)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-bold text-foreground">
                            Friend {t.referred_user_id?.slice(0, 6) ?? "—"}
                          </div>
                          <div className="text-[11px] text-muted-foreground">{date}</div>
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
