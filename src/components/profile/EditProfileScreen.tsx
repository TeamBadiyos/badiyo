import { getAuthUser } from "@/lib/authUser";
import { ArrowLeft, User, Camera } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getErrorMessage } from "@/lib/errorMessage";
import { signAddressPhotoUrl } from "@/lib/storageUrl";



export function EditProfileScreen({ onBack }: { onBack: () => void }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [syntheticEmail, setSyntheticEmail] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [initialPhone, setInitialPhone] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [authProvider, setAuthProvider] = useState<string | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();


  useEffect(() => {
    (async () => {
      const { data: userRes } = await getAuthUser();
      const u = userRes.user;
      if (!u) return;
      setUid(u.id);
      // Auth provider: 'phone' for OTP, 'email'/'google' etc for others
      const providers = (u.app_metadata?.providers as string[] | undefined) ?? [];
      const primary = (u.app_metadata?.provider as string | undefined) ?? providers[0] ?? null;
      setAuthProvider(primary);

      const { data } = await supabase
        .from("users")
        .select("full_name, email, phone, avatar_url")
        .eq("id", u.id)
        .single();
      if (data) {
        setFullName(data.full_name ?? "");
        const rawEmail = data.email ?? "";
        // Hide internal synthetic emails used for phone-OTP auth
        const isSynthetic = /@badiyos?\.phone\.local$/i.test(rawEmail);
        setSyntheticEmail(isSynthetic ? rawEmail : null);
        setEmail(isSynthetic ? "" : rawEmail);
        setPhone(data.phone ?? "");
        setInitialPhone(data.phone ?? "");
        setAvatarUrl(await signAddressPhotoUrl(data.avatar_url ?? null));
      }
    })();
  }, []);

  // Phone is read-only only when the user signed in via mobile AND already has a phone set.
  const phoneReadOnly = authProvider === "phone" && !!initialPhone;

  async function handlePhotoPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !uid) return;
    setUploading(true);
    setUploadError(null);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${uid}/avatar-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("address-photos")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("address-photos").getPublicUrl(path);
      const url = pub.publicUrl;
      const { error: updErr } = await supabase
        .from("users")
        .update({ avatar_url: url })
        .eq("id", uid);
      if (updErr) throw updErr;
      setAvatarUrl(await signAddressPhotoUrl(url));
      queryClient.invalidateQueries({ queryKey: ["user-avatar-url"] });

    } catch (err) {
      console.error("Avatar upload failed:", err);
      setUploadError(await getErrorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    if (!uid) return;
    const name = fullName.trim();
    const mobile = phone.replace(/\D/g, "").slice(-10);
    if (!name) {
      setFormError("Please enter your name");
      return;
    }
    if (!phoneReadOnly && !/^[6-9]\d{9}$/.test(mobile)) {
      setFormError("Please enter a valid 10-digit mobile number");
      return;
    }
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) {
      setFormError("Please enter a valid email or leave it blank");
      return;
    }
    setFormError(null);
    setSaving(true);
    setSaved(false);
    const update: { full_name: string | null; email: string | null; phone?: string | null } = {
      full_name: name,
      email: email ? email : syntheticEmail,
    };
    if (!phoneReadOnly) {
      update.phone = mobile;
    }
    const { error } = await supabase.from("users").update(update).eq("id", uid);
    setSaving(false);
    if (error) {
      setFormError(error.message);
    }
    if (!error) {
      setPhone(mobile);
      setInitialPhone(mobile);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    }
  }

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
          <h1 className="text-lg font-bold text-foreground">Edit Profile</h1>
        </header>

        <section className="mt-6 flex flex-col items-center">
          <div className="relative">
            <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-2 border-primary/60 bg-primary/10">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
              ) : (
                <User className="h-10 w-10 text-primary" />
              )}
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm disabled:opacity-60"
              aria-label="Change photo"
            >
              <Camera className="h-4 w-4" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePhotoPick}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {uploading ? "Uploading…" : "Tap to change photo"}
          </p>
          {uploadError && (
            <p className="mt-1 text-xs text-destructive">{uploadError}</p>
          )}
        </section>

        <section className="mt-8 space-y-4">
          <Field label="Full Name *">
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Your name"
              className="w-full rounded-[14px] border border-border bg-card px-4 py-3 text-sm text-foreground outline-none focus:border-primary"
            />
          </Field>
          <Field label="Email (optional)">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-[14px] border border-border bg-card px-4 py-3 text-sm text-foreground outline-none focus:border-primary"
            />
          </Field>
          <Field label="Mobile Number *">
            <input
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => !phoneReadOnly && setPhone(e.target.value)}
              readOnly={phoneReadOnly}
              placeholder={phoneReadOnly ? "" : "Add your mobile number"}
              className={
                phoneReadOnly
                  ? "w-full rounded-[14px] border border-border bg-muted px-4 py-3 text-sm text-muted-foreground"
                  : "w-full rounded-[14px] border border-border bg-card px-4 py-3 text-sm text-foreground outline-none focus:border-primary"
              }
            />
            {phoneReadOnly && (
              <p className="mt-1 text-xs text-muted-foreground">Phone number cannot be changed.</p>
            )}
          </Field>
        </section>

        {formError && (
          <p className="mt-4 text-xs font-semibold text-destructive">{formError}</p>
        )}
        <button
          onClick={handleSave}
          disabled={saving}
          className="mt-8 w-full rounded-[14px] bg-primary py-3 text-sm font-bold text-primary-foreground disabled:opacity-60"
        >
          {saving ? "Saving..." : saved ? "Saved ✓" : "Save"}
        </button>
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
