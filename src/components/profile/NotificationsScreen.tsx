import { getAuthUser } from "@/lib/authUser";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getErrorMessage } from "@/lib/errorMessage";

type Pref = { key: "booking" | "promos" | "referrals"; label: string; desc: string };

const PREFS: Pref[] = [
  { key: "booking", label: "Booking updates", desc: "Confirmations, reminders and status changes" },
  { key: "promos", label: "Promotions & offers", desc: "Deals and seasonal discounts" },
  { key: "referrals", label: "Referral updates", desc: "When friends join and earn you coins" },
];

const DEFAULTS = { booking: true, promos: true, referrals: true };

export function NotificationsScreen({ onBack }: { onBack: () => void }) {
  const [state, setState] = useState<Record<string, boolean>>(DEFAULTS);
  const [uid, setUid] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: userRes } = await getAuthUser();
      const id = userRes.user?.id ?? null;
      if (cancelled) return;
      setUid(id);
      if (!id) return;
      const { data } = await supabase
        .from("users")
        .select("notification_preferences")
        .eq("id", id)
        .maybeSingle();
      if (cancelled) return;
      const prefs = (data?.notification_preferences ?? {}) as Record<string, boolean>;
      setState({ ...DEFAULTS, ...prefs });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle(key: string) {
    const next = { ...state, [key]: !state[key] };
    setState(next);
    if (!uid) return;
    try {
      const { error } = await supabase
        .from("users")
        .update({ notification_preferences: next })
        .eq("id", uid);
      if (error) throw error;
    } catch (e) {
      setState(state);
      toast.error(await getErrorMessage(e));
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
          <h1 className="text-lg font-bold text-foreground">Notifications</h1>
        </header>

        <section className="mt-6 divide-y divide-border overflow-hidden rounded-[18px] border border-border bg-card shadow-sm">
          {PREFS.map((p) => {
            const on = state[p.key];
            return (
              <div key={p.key} className="flex items-center gap-3 px-4 py-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-foreground">{p.label}</p>
                  <p className="text-xs text-muted-foreground">{p.desc}</p>
                </div>
                <button
                  role="switch"
                  aria-checked={on}
                  onClick={() => toggle(p.key)}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition ${
                    on ? "bg-primary" : "bg-muted"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
                      on ? "left-[22px]" : "left-0.5"
                    }`}
                  />
                </button>
              </div>
            );
          })}
        </section>
      </div>
    </main>
  );
}
