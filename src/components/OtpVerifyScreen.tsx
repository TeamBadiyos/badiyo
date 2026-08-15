import { useEffect, useRef, useState } from "react";
import { BadiyoLogo } from "./BadiyoLogo";
import { supabase } from "@/integrations/supabase/client";
import { getErrorMessage } from "@/lib/errorMessage";
import { hapticImpact } from "@/lib/haptics";

export function OtpVerifyScreen({
  phone,
  onBack,
  onVerified,
}: {
  phone: string; // 10-digit
  onBack: () => void;
  onVerified: () => void;
}) {
  const [digits, setDigits] = useState<string[]>(["", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(30);
  const [resending, setResending] = useState(false);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    inputs.current[0]?.focus();
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const code = digits.join("");

  const verify = async (fullCode: string) => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("verify-otp", {
        body: { phone, code: fullCode },
      });
      if (fnErr) throw fnErr;
      if (!data?.access_token || !data?.refresh_token) {
        throw new Error(data?.error || "Invalid code");
      }
      const { error: sessErr } = await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });
      if (sessErr) throw sessErr;
      onVerified();
    } catch (err) {
      console.error("verify-otp failed", err);
      setError(await getErrorMessage(err));
      setDigits(["", "", "", ""]);
      inputs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (i: number, val: string) => {
    const v = val.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[i] = v;
    setDigits(next);
    if (v && i < 3) inputs.current[i + 1]?.focus();
    if (next.every((d) => d) && !loading) verify(next.join(""));
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      inputs.current[i - 1]?.focus();
    }
  };

  const handleResend = async () => {
    if (cooldown > 0 || resending) return;
    setResending(true);
    setError(null);
    try {
      const { error: fnErr } = await supabase.functions.invoke("send-otp", {
        body: { phone },
      });
      if (fnErr) throw fnErr;
      setCooldown(30);
    } catch (err) {
      console.error("resend send-otp failed", err);
      setError(await getErrorMessage(err));
    } finally {
      setResending(false);
    }
  };

  return (
    <main className="min-h-screen w-full bg-background">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pt-16 pb-10">
        <div className="flex justify-center">
          <BadiyoLogo variant="green" className="h-12 w-auto" />
        </div>

        <div className="mt-10 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Enter verification code
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sent via WhatsApp to <span className="font-semibold text-foreground">+91 {phone}</span>
          </p>
        </div>

        <div className="mt-10 flex justify-center gap-3">
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => {
                inputs.current[i] = el;
              }}
              type="tel"
              inputMode="numeric"
              maxLength={1}
              value={d}
              onChange={(e) => handleChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              className="h-16 w-14 rounded-[14px] border-2 border-border bg-card text-center text-3xl font-bold text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          ))}
        </div>

        {error && (
          <p className="mt-4 text-center text-sm font-medium text-destructive">{error}</p>
        )}

        {loading && (
          <p className="mt-4 text-center text-sm text-muted-foreground">Verifying…</p>
        )}

        <div className="mt-8 text-center text-sm text-muted-foreground">
          Didn't get it?{" "}
          <button
            type="button"
            onClick={() => { void hapticImpact("light"); handleResend(); }}
            disabled={cooldown > 0 || resending}
            className="font-semibold text-primary disabled:text-muted-foreground disabled:cursor-not-allowed"
          >
            {resending ? "Resending…" : cooldown > 0 ? `Resend OTP (${cooldown}s)` : "Resend OTP"}
          </button>
        </div>

        <button
          type="button"
          onClick={onBack}
          className="mt-4 text-center text-sm font-semibold text-muted-foreground"
        >
          Change number
        </button>

        <p className="mt-auto pt-10 text-center text-xs text-muted-foreground">
          By continuing, you agree to badiyos' Terms & Privacy Policy.
        </p>
      </div>
    </main>
  );
}
