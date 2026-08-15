import { useEffect, useState } from "react";
import { BadiyoLogo } from "./BadiyoLogo";
import { GoogleIcon } from "./GoogleIcon";
import { supabase } from "@/integrations/supabase/client";
import { captureReferralCode } from "@/lib/referrals";
import { getErrorMessage } from "@/lib/errorMessage";
import { hapticImpact } from "@/lib/haptics";

export function LoginScreen({
  onOtpSent,
  onPinLogin,
}: {
  onOtpSent?: (phone: string) => void;
  onPinLogin?: (phone: string) => void;
} = {}) {
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    captureReferralCode();
  }, []);

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
    setPhone(digits);
  };

  const isValid = phone.length === 10;

  const handleContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || loading) return;
    setLoading(true);
    setError(null);
    try {
      // If this phone already has a PIN, skip OTP and go straight to
      // biometric/PIN entry.
      const { data: hasPin, error: chkErr } = await supabase.rpc("has_login_pin", {
        p_phone: `+91${phone}`,
      });
      if (chkErr) console.warn("has_login_pin check failed", chkErr);
      if (hasPin === true) {
        onPinLogin?.(phone);
        return;
      }

      const { data, error: fnErr } = await supabase.functions.invoke("send-otp", {
        body: { phone },
      });
      if (fnErr) throw fnErr;
      if (data?.error) throw new Error(data.error);
      onOtpSent?.(phone);
    } catch (err) {
      console.error("login continue failed:", err);
      setError(await getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      // Referral code (if any) is already captured to localStorage on mount
      // and will be linked on return via onAuthStateChange in the root.
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin },
      });
      if (oauthError) throw oauthError;
      // Browser navigates away to Google; no further action here.
    } catch (err) {
      console.error("Google sign-in failed:", err);
      setError(await getErrorMessage(err));
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen w-full bg-background">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pt-16 pb-10">
        {/* Logo */}
        <div className="flex justify-center">
          <BadiyoLogo variant="green" className="h-12 w-auto" />
        </div>

        {/* Heading */}
        <div className="mt-10 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Welcome to badiyos
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in to book trusted home cleaning services
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleContinue} className="mt-10 space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-foreground">
              Mobile number
            </span>
            <div className="flex items-center gap-2 rounded-[14px] border border-border bg-card px-4 py-3 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition">
              <span className="text-sm font-semibold text-foreground select-none">
                +91
              </span>
              <span className="h-5 w-px bg-border" />
              <input
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                placeholder="10-digit mobile number"
                value={phone}
                onChange={handlePhoneChange}
                className="w-full bg-transparent text-base font-medium text-foreground outline-none placeholder:text-muted-foreground/70"
              />
            </div>
          </label>

          <button
            type="submit"
            disabled={!isValid || loading}
            className="w-full rounded-[14px] bg-primary px-4 py-3.5 text-base font-bold text-primary-foreground transition active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Please wait…" : "Continue"}
          </button>
          {error && (
            <p className="text-center text-sm font-medium text-destructive">{error}</p>
          )}
        </form>

        {/* Divider */}
        <div className="my-8 flex items-center gap-4">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            or
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>

        {/* Google */}
        <button
          type="button"
          onClick={() => { void hapticImpact("light"); handleGoogle(); }}
          className="flex w-full items-center justify-center gap-3 rounded-[14px] border border-border bg-card px-4 py-3.5 text-base font-semibold text-foreground transition hover:bg-muted active:scale-[0.99]"
        >
          <GoogleIcon />
          Continue with Google
        </button>

        <p className="mt-auto pt-10 text-center text-xs text-muted-foreground">
          By continuing, you agree to badiyos' Terms & Privacy Policy.
        </p>
      </div>
    </main>
  );
}
