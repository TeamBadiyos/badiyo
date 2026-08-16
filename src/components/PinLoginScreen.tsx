import { useCallback, useEffect, useRef, useState } from "react";
import { Fingerprint } from "lucide-react";
import { BadiyoLogo } from "./BadiyoLogo";
import { supabase } from "@/integrations/supabase/client";
import { getErrorMessage } from "@/lib/errorMessage";
import { authenticateBiometric, checkBiometric } from "@/lib/biometric";
import { loadDevicePin, clearDevicePin } from "@/lib/pinStorage";

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(fallback), ms);
    promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        window.clearTimeout(timer);
        resolve(fallback);
      });
  });
}

/**
 * PIN entry screen for returning customers. Auto-triggers a biometric prompt
 * on mount when hardware is available AND a device-stored PIN exists — the
 * user never types anything. Falls back to manual 4-digit entry. Handles
 * lockout responses from verify-pin-login (429) and offers OTP fallback.
 */
export function PinLoginScreen({
  phone, // 10-digit
  onBack,
  onVerified,
  onFallbackOtp, // triggers the normal send-otp path
  onForgotPin,   // same as OTP fallback but signals intent to reset
}: {
  phone: string;
  onBack: () => void;
  onVerified: () => void;
  onFallbackOtp: () => void;
  onForgotPin: () => void;
}) {
  const [digits, setDigits] = useState<string[]>(["", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState<number>(0); // seconds remaining
  const [biometricStatus, setBiometricStatus] = useState<
    "checking" | "prompting" | "unavailable" | "failed" | "success"
  >("checking");
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const autoTriedRef = useRef(false);
  const submittingRef = useRef(false);

  const submit = useCallback(
    async (code: string) => {
      if (loading || submittingRef.current) return;
      submittingRef.current = true;
      setLoading(true);
      setError(null);
      try {
        const { data, error: fnErr } = await supabase.functions.invoke("verify-pin-login", {
          body: { phone, pin: code },
        });
        // supabase.functions.invoke throws FunctionsHttpError for non-2xx,
        // but the JSON body still comes back in the error's context.
        if (fnErr) {
          // Try to read the body for retry_after_seconds.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const ctx: any = (fnErr as any).context;
          let body: { error?: string; retry_after_seconds?: number } | null = null;
          try {
            body = ctx?.json ? await ctx.json() : null;
          } catch {
            body = null;
          }
          if (body?.retry_after_seconds && body.retry_after_seconds > 0) {
            setLocked(body.retry_after_seconds);
            setError(body.error || "Too many attempts.");
          } else {
            setError(body?.error || (await getErrorMessage(fnErr)));
          }
          setDigits(["", "", "", ""]);
          inputs.current[0]?.focus();
          return;
        }
        if (data?.retry_after_seconds) {
          setLocked(data.retry_after_seconds);
          setError(data.error || "Too many attempts.");
          setDigits(["", "", "", ""]);
          return;
        }
        if (!data?.access_token || !data?.refresh_token) {
          throw new Error(data?.error || "Incorrect PIN");
        }
        const { error: sessErr } = await supabase.auth.setSession({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
        });
        if (sessErr) throw sessErr;
        onVerified();
      } catch (err) {
        console.error("verify-pin-login failed", err);
        setError(await getErrorMessage(err));
        setDigits(["", "", "", ""]);
        inputs.current[0]?.focus();
      } finally {
        submittingRef.current = false;
        setLoading(false);
      }
    },
    [loading, onVerified, phone],
  );

  // Lockout countdown ticker.
  useEffect(() => {
    if (locked <= 0) return;
    const t = setTimeout(() => setLocked((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [locked]);

  // Biometric-first: try immediately on mount.
  useEffect(() => {
    if (autoTriedRef.current) return;
    autoTriedRef.current = true;
    (async () => {
      const stored = await withTimeout(loadDevicePin(phone), 5000, null);
      if (!stored) {
        setBiometricStatus("unavailable");
        return;
      }
      const status = await checkBiometric();
      if (status !== "available") {
        setBiometricStatus("unavailable");
        return;
      }
      setBiometricStatus("prompting");
      const ok = await authenticateBiometric("Log in to badiyos", 8000);
      if (ok) {
        setBiometricStatus("success");
        await submit(stored);
      } else {
        setBiometricStatus("failed");
        setTimeout(() => inputs.current[0]?.focus(), 50);
      }
    })();
  }, [phone, submit]);

  const handleChange = (i: number, val: string) => {
    if (locked > 0) return;
    const v = val.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[i] = v;
    setDigits(next);
    if (v && i < 3) inputs.current[i + 1]?.focus();
    if (next.every((d) => d) && !loading) void submit(next.join(""));
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) inputs.current[i - 1]?.focus();
  };

  const retryBiometric = async () => {
    const stored = await withTimeout(loadDevicePin(phone), 5000, null);
    if (!stored) return;
    const ok = await authenticateBiometric("Log in to badiyos");
    if (ok) void submit(stored);
  };

  const handleForgotPin = () => {
    setError(null);
    setDigits(["", "", "", ""]);
    onForgotPin();
    void withTimeout(clearDevicePin(phone), 1500, undefined);
  };

  return (
    <main className="min-h-screen w-full overflow-y-auto bg-background">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pt-10 pb-10">

        <div className="flex justify-center">
          <BadiyoLogo variant="green" className="h-12 w-auto" />
        </div>

        <div className="mt-10 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Welcome back
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in as <span className="font-semibold text-foreground">+91 {phone}</span>
          </p>
        </div>

        {biometricStatus === "prompting" && (
          <div className="mt-8 flex flex-col items-center gap-2 text-muted-foreground">
            <Fingerprint className="h-10 w-10 text-primary" />
            <p className="text-sm">Use biometric unlock, or enter your PIN below.</p>
          </div>
        )}

        <p className="mt-8 text-center text-sm font-semibold text-foreground">
          Enter your 4-digit PIN
        </p>
        <div className="mt-4 flex justify-center gap-3">
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => {
                inputs.current[i] = el;
              }}
              type="tel"
              inputMode="numeric"
              maxLength={1}
              value={d ? "•" : ""}
              disabled={locked > 0 || loading}
              onChange={(e) => handleChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              className="h-16 w-14 rounded-[14px] border-2 border-border bg-card text-center text-3xl font-bold text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
            />
          ))}
        </div>
        {biometricStatus !== "checking" && biometricStatus !== "unavailable" && (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={retryBiometric}
              disabled={loading || locked > 0 || biometricStatus === "prompting"}
              className="flex items-center gap-2 text-sm font-semibold text-primary disabled:opacity-50"
            >
              <Fingerprint className="h-4 w-4" /> Use biometric
            </button>
          </div>
        )}

        {error && (
          <p className="mt-4 text-center text-sm font-medium text-destructive">{error}</p>
        )}
        {locked > 0 && (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Try again in {Math.ceil(locked / 60)} min ({locked}s)
          </p>
        )}
        {loading && (
          <p className="mt-4 text-center text-sm text-muted-foreground">Verifying…</p>
        )}

        <div className="mt-8 flex flex-col items-center gap-3 text-sm">
          <button
            type="button"
            onClick={handleForgotPin}
            className="relative z-10 min-h-11 px-4 py-2 font-semibold text-primary active:scale-[0.98]"
          >
            Forgot PIN?
          </button>
          <button
            type="button"
            onClick={onFallbackOtp}
            className="font-semibold text-muted-foreground"
          >
            Login with OTP instead
          </button>
          <button
            type="button"
            onClick={onBack}
            className="text-muted-foreground"
          >
            Change number
          </button>
        </div>

        <p className="mt-auto pt-10 text-center text-xs text-muted-foreground">
          By continuing, you agree to badiyos' Terms & Privacy Policy.
        </p>
      </div>
    </main>
  );
}
