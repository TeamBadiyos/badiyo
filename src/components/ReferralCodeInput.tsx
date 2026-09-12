import { useEffect, useState } from "react";
import { Check, Gift } from "lucide-react";
import {
  applyReferralCode,
  getStoredReferralCode,
  referralResultMessage,
} from "@/lib/referrals";

type Props = {
  /** Hide the field entirely and show a confirmation when a referrer already exists. */
  alreadyReferred?: boolean;
  onApplied?: () => void;
  /** Lets a parent form read the typed code so it can apply it on its own save. */
  onCodeChange?: (code: string) => void;
  className?: string;
};

/** Small "Have an invite code?" box used on the profile popup and Refer & Earn. */
export function ReferralCodeInput({
  alreadyReferred,
  onApplied,
  onCodeChange,
  className,
}: Props) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const stored = getStoredReferralCode();
    if (stored) {
      setCode(stored);
      onCodeChange?.(stored);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateCode(next: string) {
    setCode(next);
    onCodeChange?.(next);
  }

  if (alreadyReferred || done) {
    return (
      <div
        className={`flex items-center gap-2 rounded-[14px] bg-primary/10 px-4 py-3 text-sm font-semibold text-primary ${className ?? ""}`}
      >
        <Check className="h-4 w-4" />
        Invite applied
      </div>
    );
  }

  async function submit() {
    if (!code.trim() || busy) return;
    setBusy(true);
    setStatus(null);
    const result = await applyReferralCode(code);
    setBusy(false);
    const text = referralResultMessage(result);
    if (result === "applied" || result === "already_referred") {
      setDone(true);
      onApplied?.();
      return;
    }
    setStatus({ ok: false, text });
  }

  return (
    <div className={className}>
      <label
        htmlFor="referral-code"
        className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground"
      >
        <Gift className="h-3.5 w-3.5" />
        Have an invite code?
      </label>
      <div className="mt-1.5 flex gap-2">
        <input
          id="referral-code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="Enter code"
          autoCapitalize="characters"
          className="h-11 flex-1 rounded-[14px] border border-border bg-card px-4 text-sm font-semibold uppercase tracking-wide text-foreground outline-none focus:border-primary"
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy || !code.trim()}
          className="h-11 rounded-[14px] bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50"
        >
          {busy ? "Applying…" : "Apply"}
        </button>
      </div>
      {status && (
        <p className="mt-1.5 text-xs font-semibold text-destructive">{status.text}</p>
      )}
    </div>
  );
}
