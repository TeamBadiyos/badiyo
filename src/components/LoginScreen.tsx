import { useEffect, useState } from "react";
import { BadiyoLogo } from "./BadiyoLogo";
import { GoogleIcon } from "./GoogleIcon";
import { supabase } from "@/integrations/supabase/client";
import { captureReferralCode } from "@/lib/referrals";
import { getErrorMessage } from "@/lib/errorMessage";
import { hapticImpact } from "@/lib/haptics";
import { hasLoginPin as checkHasLoginPin } from "@/lib/auth.functions";
import { LegalConsentText } from "./LegalConsentText";
import { useT, useLanguage } from "@/i18n";
import type { LegalSlug } from "./profile/LegalPageScreen";


export function LoginScreen({
  onOtpSent,
  onPinLogin,
  onOpenLegal,
}: {
  onOtpSent?: (phone: string) => void;
  onPinLogin?: (phone: string) => void;
  onOpenLegal?: (slug: LegalSlug) => void;
} = {}) {
  const t = useT();
  const { lang, setLang } = useLanguage();
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
      // biometric/PIN entry. Checked server-side (service role) so the
      // has_login_pin RPC stays inaccessible to anonymous browsers.
      let hasPin = false;
      try {
        const res = await checkHasLoginPin({ data: { phone } });
        hasPin = res.hasPin;
      } catch (chkErr) {
        console.warn("has_login_pin check failed", chkErr);
      }
      if (hasPin) {
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
    <main className="flex min-h-screen w-full flex-col bg-primary">
      {/* Gradient header with wordmark and tagline */}
      <header className="flex flex-1 flex-col items-center justify-center bg-gradient-to-b from-primary-dark via-primary to-primary-light px-6 pb-12 pt-12 min-h-[240px]">
        <BadiyoLogo variant="white" className="h-12 w-auto" />
        <p className="mt-3 text-center text-base font-medium text-white/90">
          {t("login.tagline")}
        </p>
      </header>

      {/* White rounded-top card overlapping the header */}
      <section className="relative -mt-8 shrink-0 rounded-t-[28px] bg-card px-6 pb-8 pt-8">
        <div className="mx-auto w-full max-w-md">
          {/* Heading */}
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {t("login.title")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("login.subtitle")}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={(e) => { void hapticImpact("medium"); handleContinue(e); }} className="mt-8 space-y-4">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-foreground">
                {t("login.mobileLabel")}
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
                  placeholder={t("login.placeholder")}
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
              {loading ? t("common.loading") : t("login.sendOtp")}
            </button>
            {error && (
              <p className="text-center text-sm font-medium text-destructive">{error}</p>
            )}
          </form>

          {/* Divider */}
          <div className="my-6 flex items-center gap-4">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("login.or")}
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>

          {/* Google */}
          <button
            type="button"
            disabled={loading}
            onClick={() => { void hapticImpact("light"); handleGoogle(); }}
            className="flex w-full items-center justify-center gap-3 rounded-[14px] border border-border bg-card px-4 py-3.5 text-base font-semibold text-foreground transition hover:bg-muted active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <GoogleIcon />
            {t("login.continueWithGoogle")}
          </button>

          {/* Language toggle + legal consent */}
          <div className="mt-8 space-y-4">
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setLang("en")}
                className={`rounded-full px-3 py-1 text-sm font-medium transition ${
                  lang === "en"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                English
              </button>
              <span className="h-4 w-px bg-border" />
              <button
                type="button"
                onClick={() => setLang("mr")}
                className={`rounded-full px-3 py-1 text-sm font-medium transition ${
                  lang === "mr"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                मराठी
              </button>
            </div>
            <LegalConsentText onOpenLegal={onOpenLegal} className="text-center" />
          </div>
        </div>
      </section>
    </main>
  );
}
