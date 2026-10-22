import { useEffect, useRef, useState } from "react";
import { BadiyoLogo } from "./BadiyoLogo";
import { supabase } from "@/integrations/supabase/client";
import { getErrorMessage } from "@/lib/errorMessage";

/**
 * Mandatory 4-digit PIN setup after first-time OTP verification.
 * On submit, calls set_login_pin(p_pin). The PIN is never stored on the device.
 */
export function PinSetScreen({
  phone,
  title = "Set your 4-digit PIN",
  subtitle = "You'll use this PIN to log in next time.",
  onDone,
}: {
  phone: string; // 10-digit
  title?: string;
  subtitle?: string;
  onDone: () => void;
}) {
  const [step, setStep] = useState<"enter" | "confirm">("enter");
  const [pin1, setPin1] = useState<string[]>(["", "", "", ""]);
  const [pin2, setPin2] = useState<string[]>(["", "", "", ""]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  const active = step === "enter" ? pin1 : pin2;
  const setActive = step === "enter" ? setPin1 : setPin2;

  useEffect(() => {
    inputs.current[0]?.focus();
  }, [step]);

  const handleChange = (i: number, val: string) => {
    const v = val.replace(/\D/g, "").slice(-1);
    const next = [...active];
    next[i] = v;
    setActive(next);
    if (v && i < 3) inputs.current[i + 1]?.focus();
    if (next.every((d) => d)) {
      const code = next.join("");
      if (step === "enter") {
        setStep("confirm");
      } else {
        void submit(pin1.join(""), code);
      }
    }
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !active[i] && i > 0) inputs.current[i - 1]?.focus();
  };

  const submit = async (first: string, second: string) => {
    setError(null);
    if (first !== second) {
      setError("PINs don't match. Try again.");
      setPin1(["", "", "", ""]);
      setPin2(["", "", "", ""]);
      setStep("enter");
      return;
    }
    setSaving(true);
    try {
      const rpcPromise = supabase.rpc("set_login_pin", { p_pin: first });
      const { error: rpcErr } = (await Promise.race([
        rpcPromise,
        new Promise((_, rej) => setTimeout(() => rej(new Error("Network timeout. Please try again.")), 12000)),
      ])) as { error: unknown };
      if (rpcErr) throw rpcErr;
      onDone();
    } catch (err) {
      console.error("set_login_pin failed", err);
      setError(await getErrorMessage(err));
      setPin1(["", "", "", ""]);
      setPin2(["", "", "", ""]);
      setStep("enter");
    } finally {
      setSaving(false);
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
            {step === "enter" ? title : "Confirm your PIN"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {step === "enter" ? subtitle : "Re-enter the same 4 digits."}
          </p>
        </div>

        <div className="mt-10 flex justify-center gap-3">
          {active.map((d, i) => (
            <input
              key={`${step}-${i}`}
              ref={(el) => {
                inputs.current[i] = el;
              }}
              type="tel"
              inputMode="numeric"
              maxLength={1}
              value={d ? "•" : ""}
              onChange={(e) => handleChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              className="h-16 w-14 rounded-[14px] border-2 border-border bg-card text-center text-3xl font-bold text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          ))}
        </div>

        {error && (
          <p className="mt-4 text-center text-sm font-medium text-destructive">{error}</p>
        )}
        {saving && (
          <p className="mt-4 text-center text-sm text-muted-foreground">Saving…</p>
        )}

        <p className="mt-auto pt-10 text-center text-xs text-muted-foreground">
          Your PIN is stored securely on this device.
        </p>
      </div>
    </main>
  );
}
