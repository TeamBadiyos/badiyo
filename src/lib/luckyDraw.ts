import { supabase } from "@/integrations/supabase/client";
import { buildPlayStoreInviteUrl } from "@/lib/referrals";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = Record<string, any>;

export type LdPrize = {
  id: string;
  name: string;
  photo: string | null;
  value: number | null;
  quantity: number | null;
  type: string;
  sort: number;
  rankFrom: number | null;
  rankTo: number | null;
};

export type LdStatus = {
  id: string;
  title: string;
  description: string | null;
  banner: string | null;
  endAt: string | null;
  drawAt: string | null;
  showEnrolledCount: boolean;
  enrolledCount: number | null;
  showLeaderboard: boolean;
  leaderboardRewards: boolean;
  topRanks: number;
  prizes: LdPrize[];
  winnersPublished: boolean;
  winners: { name: string; prize: string | null; rank: number | null }[];
  my: { entryNo: string; entries: number; referrals: number; won: boolean; wonPrize: string | null } | null;
};

const num = (v: any): number | null => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? null : Number(v));
const str = (v: any): string | null => (typeof v === "string" && v.trim() ? v : null);

/** Always mask to "Rahul S." — never show a full name or phone. */
export function maskName(raw: any): string {
  const s = String(raw ?? "").replace(/[+\d]{6,}/g, "").trim();
  if (!s) return "Badiyos user";
  const parts = s.split(/\s+/);
  const first = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  const last = parts.length > 1 ? ` ${parts[parts.length - 1].charAt(0).toUpperCase()}.` : "";
  return first + last;
}

function normPrize(p: Any, i: number): LdPrize {
  return {
    id: String(p.id ?? i),
    name: str(p.name) ?? str(p.title) ?? "Prize",
    photo: str(p.photo_url) ?? str(p.image_url) ?? str(p.photo) ?? str(p.image) ?? null,
    value: num(p.value_inr ?? p.worth ?? p.value),
    quantity: num(p.quantity ?? p.qty),
    type: (str(p.type) ?? str(p.prize_type)) === "leaderboard" ? "leaderboard" : "draw",
    sort: ((str(p.type) ?? str(p.prize_type)) === "leaderboard" ? 10000 : 0) + (num(p.sort_no) ?? i),
    rankFrom: num(p.rank_from),
    rankTo: num(p.rank_to),
  };
}

export async function fetchLuckyDrawStatus(): Promise<LdStatus | null> {
  const { data, error } = await supabase.rpc("customer_lucky_draw_status");
  if (error) throw error;
  const d = (data ?? null) as Any | null;
  const c: Any | null = d && (d.campaign ?? (d.id ? d : null));
  if (!c || !c.id || c.is_active === false) return null;
  const prizesRaw: Any[] = d!.prizes ?? c.prizes ?? [];
  const myRaw: Any | null = d!.my ?? c.my ?? null;
  const winnersRaw: Any[] = d!.winners ?? c.winners ?? [];
  const published = Boolean(d!.winners_published ?? c.winners_published ?? winnersRaw.length > 0);
  const myWin: Any | null = myRaw?.winner ?? myRaw?.won_prize ?? null;
  return {
    id: String(c.id),
    title: str(c.title) ?? "Lucky Draw",
    description: str(c.description),
    banner: str(c.banner_url),
    endAt: str(c.end_at),
    drawAt: str(c.draw_at) ?? str(c.draw_date) ?? str(c.end_at),
    showEnrolledCount: Boolean(c.show_enrolled_count),
    enrolledCount: num(d!.enrolled_count ?? c.enrolled_count),
    showLeaderboard: Boolean(c.show_leaderboard),
    leaderboardRewards: c.leaderboard_rewards_enabled !== false,
    topRanks: num(c.leaderboard_top_ranks) ?? 0,
    prizes: prizesRaw.map(normPrize).sort((a, b) => a.sort - b.sort),
    winnersPublished: published,
    winners: published
      ? winnersRaw.map((w) => ({
          name: maskName(w.display_name ?? w.name),
          prize: str(w.prize_name) ?? str(w.prize),
          rank: num(w.rank),
        }))
      : [],
    my: myRaw && (myRaw.entry_no || myRaw.enrolled)
      ? {
          entryNo: String(myRaw.entry_no ?? ""),
          entries: num(myRaw.entries) ?? 1,
          referrals: num(myRaw.referrals) ?? 0,
          won: Boolean(myRaw.won ?? myRaw.is_winner ?? myWin),
          wonPrize: typeof myWin === "string" ? myWin : str(myWin?.prize_name) ?? null,
        }
      : null,
  };
}

export type LdRow = { rank: number; name: string; referrals: number; isMe: boolean };

export async function fetchLeaderboard(limit: number): Promise<{ rows: LdRow[]; me: LdRow | null; hasMore: boolean }> {
  const { data, error } = await supabase.rpc("customer_lucky_draw_leaderboard", { _limit: limit });
  if (error) throw error;
  const d = (data ?? {}) as Any;
  const list: Any[] = Array.isArray(d) ? d : d.rows ?? d.items ?? d.leaderboard ?? d.entries ?? [];
  const rows = list.map((r, i) => ({
    rank: num(r.rank) ?? i + 1,
    name: maskName(r.display_name ?? r.name),
    referrals: num(r.referrals ?? r.referral_count) ?? 0,
    isMe: Boolean(r.is_me ?? r.me),
  }));
  const m: Any | null = Array.isArray(d) ? null : d.my ?? d.me ?? null;
  const me = m && m.rank
    ? { rank: Number(m.rank), name: "You", referrals: num(m.referrals ?? m.referral_count) ?? 0, isMe: true }
    : rows.find((r) => r.isMe) ?? null;
  const total = Array.isArray(d) ? null : num(d.total);
  return { rows, me, hasMore: total !== null ? rows.length < total : rows.length >= limit };
}

export function luckyDrawErrorMessage(e: any): string {
  const msg = String(e?.message ?? e?.error ?? e ?? "").toLowerCase();
  if (/fetch|network|timeout|offline/.test(msg)) return "Network problem. Please check your internet and try again.";
  if (/already/.test(msg)) return "You are already enrolled in this contest.";
  if (/ended|closed|expired|over|not active|inactive/.test(msg)) return "This contest has ended.";
  if (/eligib|not allowed|blocked/.test(msg)) return "Sorry, you are not eligible for this contest.";
  return "Something went wrong. Please try again.";
}

export async function enrolLuckyDraw(): Promise<string> {
  const { data, error } = await supabase.rpc("customer_lucky_draw_enrol");
  if (error) throw error;
  const d = (data ?? {}) as Any;
  if (d.success === false) throw new Error(String(d.error ?? d.reason ?? d.message ?? "failed"));
  return String(d.entry_no ?? "");
}

/** Reuses the existing referral invite message. */
export async function shareReferralInvite(imageUrl?: string | null): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  let code = "";
  if (uid) {
    const { data } = await supabase.from("users").select("referral_code").eq("id", uid).maybeSingle();
    code = data?.referral_code ?? "";
  }
  const text = [
    "*इस दिवाली, आपके घर आ सकता है ₹50,000 का Robot Floor Cleaner Free!* 🤩",
    "",
    "*Badiyos की ओर से दिवाली का खास तोहफ़ा! 100 से ज़्यादा शानदार इनाम!* 🎁",
    "",
    "भाग लेना बेहद आसान है:",
    "✅ Badiyos ऐप डाउनलोड करें",
    "✅ कॉन्टेस्ट में अपना नाम दर्ज करें",
    "",
    "*अभी Badiyos ऐप डाउनलोड करें और कॉन्टेस्ट में शामिल हों!* 📲",
    buildPlayStoreInviteUrl(code),
    "",
    "*Badiyos — हर घर का अपना साथी।* 💚",
  ].join("\n");
  // Fetch the contest banner (image + caption share).
  let blob: Blob | null = null;
  if (imageUrl) {
    try {
      const res = await fetch(imageUrl, { cache: "force-cache" });
      if (res.ok) blob = await res.blob();
      else console.warn("[invite] image fetch failed", res.status);
    } catch (e) {
      console.warn("[invite] image fetch error", e);
      blob = null;
    }
  }
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (Capacitor.isNativePlatform()) {
      const { Share } = await import("@capacitor/share");
      const fsAvailable = Capacitor.isPluginAvailable("Filesystem");
      if (blob && fsAvailable) {
        try {
          const { Filesystem, Directory } = await import("@capacitor/filesystem");
          const b64 = await new Promise<string>((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
            r.onerror = reject;
            r.readAsDataURL(blob as Blob);
          });
          const ext = blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : "jpg";
          const saved = await Filesystem.writeFile({
            path: `badiyos-contest-${Date.now()}.${ext}`,
            data: b64,
            directory: Directory.Cache,
          });
          await Share.share({ text, files: [saved.uri], dialogTitle: "Share badiyos" });
          return;
        } catch (e) {
          console.warn("[invite] native image share failed", e);
        }
      } else if (!fsAvailable) {
        console.warn("[invite] Filesystem plugin missing in installed app — update APK");
      }
      // Older app build: put the banner link on top so WhatsApp shows a photo preview.
      const fallbackText = imageUrl ? `${imageUrl}\n\n${text}` : text;
      await Share.share({ text: fallbackText, dialogTitle: "Share badiyos" });
      return;
    }
  } catch {
    /* fall through */
  }
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      if (blob) {
        const file = new File([blob], blob.type.includes("png") ? "badiyos-contest.png" : "badiyos-contest.jpg", {
          type: blob.type || "image/jpeg",
        });
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ text, files: [file] });
          return;
        }
      }
      await navigator.share({ text });
      return;
    } catch {
      return;
    }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
}

export const LD_STATUS_KEY = ["lucky_draw_status"] as const;

export function formatLdDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}
