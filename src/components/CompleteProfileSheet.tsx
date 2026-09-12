import { useEffect, useRef, useState } from "react";
import { Camera, User, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { signAddressPhotoUrl } from "@/lib/storageUrl";
import { uploadAvatar } from "@/lib/profileMedia";
import { getErrorMessage } from "@/lib/errorMessage";
import { ReferralCodeInput } from "@/components/ReferralCodeInput";
import { applyReferralCode, referralResultMessage } from "@/lib/referrals";
import { toast } from "sonner";

function isSynthetic(email: string | null | undefined) {
  return !!email && /@badiyos?\.phone\.local$/i.test(email);
}

/**
 * Nudges a signed-in customer to fill in their name, email and photo.
 * Skippable — reappears on the next app open / foreground until name + email
 * are set. The skip is intentionally in-memory only: persisting it (e.g. in
 * sessionStorage) hid the popup forever inside the Capacitor webview, which is
 * never torn down between app opens.
 */
export function CompleteProfileSheet({ enabled }: { enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [uid, setUid] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [alreadyReferred, setAlreadyReferred] = useState(false);
  const [referralCode, setReferralCode] = useState("");
  const [referralApplied, setReferralApplied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  /** Bumped whenever the popup should be re-evaluated (foreground, sign-in). */
  const [tick, setTick] = useState(0);
  const skippedRef = useRef(false);
  const checkingRef = useRef(false);

  // Re-check on app resume / tab becoming visible again, and on sign-in.
  useEffect(() => {
    let cancelled = false;
    const bump = () => {
      if (cancelled) return;
      skippedRef.current = false;
      setTick((t) => t + 1);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") bump();
    };
    document.addEventListener("visibilitychange", onVisible);

    let removeApp: (() => void) | undefined;
    import("@capacitor/app")
      .then(({ App }) =>
        App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) bump();
        }),
      )
      .then((handle) => {
        if (cancelled) handle.remove();
        else removeApp = () => handle.remove();
      })
      .catch(() => {
        /* web build: visibilitychange is enough */
      });

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "USER_UPDATED") bump();
    });

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      removeApp?.();
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!enabled || skippedRef.current || checkingRef.current) return;
    checkingRef.current = true;
    (async () => {
      try {
        const { data: userRes } = await supabase.auth.getUser();
        const u = userRes.user;
        if (!u) return;
        const { data } = await supabase
          .from("users")
          .select("full_name, email, avatar_url, referred_by")
          .eq("id", u.id)
          .maybeSingle();
        if (!data) return;
        const nameOk = !!data.full_name?.trim();
        const emailOk = !!data.email && !isSynthetic(data.email);
        if (nameOk && emailOk) return;
        setUid(u.id);
        setFullName(data.full_name ?? "");
        setEmail(isSynthetic(data.email) ? "" : (data.email ?? ""));
        setAvatarUrl(await signAddressPhotoUrl(data.avatar_url ?? null));
        setAlreadyReferred(!!data.referred_by);
        setReferralApplied(false);
        setError(null);
        setOpen(true);
      } finally {
        checkingRef.current = false;
      }
    })();
  }, [enabled, tick]);

  function dismiss() {
    skippedRef.current = true;
    setOpen(false);
  }

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !uid) return;
    setUploading(true);
    try {
      const url = await uploadAvatar(uid, file);
      setAvatarUrl(await signAddressPhotoUrl(url));
    } catch (err) {
      toast.error(await getErrorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (!uid) return;
    const name = fullName.trim();
    const mail = email.trim();
    if (!name) return setError("Please enter your name");
    if (!/^\S+@\S+\.\S+$/.test(mail)) return setError("Please enter a valid email");
    setError(null);
    setSaving(true);
    const { error: updErr } = await supabase
      .from("users")
      .update({ full_name: name, email: mail })
      .eq("id", uid);
    if (updErr) {
      setSaving(false);
      setError(await getErrorMessage(updErr));
      return;
    }

    // Apply a typed invite code that the user never tapped "Apply" on.
    const code = referralCode.trim();
    if (code && !alreadyReferred && !referralApplied) {
      const result = await applyReferralCode(code);
      if (result !== "applied" && result !== "already_referred") {
        setSaving(false);
        setError(referralResultMessage(result));
        return;
      }
      setReferralApplied(true);
    }

    setSaving(false);
    queryClient.invalidateQueries();
    toast.success("Profile updated");
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 animate-fade-in">
      <div
        role="dialog"
        aria-label="Complete your profile"
        className="w-full max-w-md rounded-t-[24px] bg-card px-5 pb-[calc(env(safe-area-inset-bottom,0px)+20px)] pt-5 animate-fade-slide-in"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-extrabold text-foreground">Complete your profile</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Helps our experts recognise you and send booking updates.
            </p>
          </div>
          <button
            onClick={dismiss}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-border"
          >
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-muted"
            aria-label="Add profile photo"
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="Profile" className="h-full w-full object-cover" />
            ) : (
              <User className="h-7 w-7 text-muted-foreground" />
            )}
            <span className="absolute bottom-0 right-0 flex h-6 w-6 items-center justify-center rounded-full bg-primary">
              <Camera className="h-3.5 w-3.5 text-primary-foreground" />
            </span>
          </button>
          <span className="text-xs text-muted-foreground">
            {uploading ? "Uploading…" : "Add a photo (optional)"}
          </span>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handlePhoto}
          />
        </div>

        <div className="mt-4 space-y-3">
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Full name"
            className="h-12 w-full rounded-[14px] border border-border bg-background px-4 text-sm font-semibold text-foreground outline-none focus:border-primary"
          />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            inputMode="email"
            placeholder="Email address"
            className="h-12 w-full rounded-[14px] border border-border bg-background px-4 text-sm font-semibold text-foreground outline-none focus:border-primary"
          />
        </div>

        <ReferralCodeInput
          className="mt-4"
          alreadyReferred={alreadyReferred}
          onCodeChange={setReferralCode}
          onApplied={() => setReferralApplied(true)}
        />

        {error && <p className="mt-2 text-xs font-semibold text-destructive">{error}</p>}

        <button
          onClick={save}
          disabled={saving}
          className="mt-5 h-12 w-full rounded-[14px] bg-primary text-sm font-bold text-primary-foreground disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save profile"}
        </button>
        <button
          onClick={dismiss}
          className="mt-2 h-10 w-full text-sm font-semibold text-muted-foreground"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
