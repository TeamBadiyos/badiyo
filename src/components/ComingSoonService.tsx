/**
 * Light "Coming soon" screen for any not-yet-live service (Food, Store…):
 * animated illustration, launch progress, "which one first?" names with
 * suggestions, and a "Ring me" waitlist button.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/i18n";
import { supabase } from "@/integrations/supabase/client";
import { ensureSignedIn } from "@/lib/authGate";
import { hapticImpact } from "@/lib/haptics";

type Svc = "food" | "store";

const CFG = {
  food: {
    demand: "food",
    en: {
      title: "Something tasty is cooking… 🍳",
      line: "Your favourite hotel's food, at home, at the same menu price.",
      ask: "Which hotel should we bring first?",
      ph: "e.g. Hotel Shreyas",
    },
    mr: {
      title: "काहीतरी चविष्ट शिजतंय… 🍳",
      line: "तुमच्या आवडत्या हॉटेलचं जेवण, घरबसल्या, हॉटेलच्याच दरात.",
      ask: "सर्वात आधी कोणतं हॉटेल आणू?",
      ph: "उदा. हॉटेल श्रेयस",
    },
  },
  store: {
    demand: "grocery",
    en: {
      title: "Your shops are on the way… 🛒",
      line: "Your favourite local shop, delivered home, at the shop's own price.",
      ask: "Which shop should we bring first?",
      ph: "e.g. Laxmi Kirana",
    },
    mr: {
      title: "तुमची दुकानं येत आहेत… 🛒",
      line: "तुमचं आवडतं दुकान, घरपोच, दुकानाच्याच दरात.",
      ask: "सर्वात आधी कोणतं दुकान आणू?",
      ph: "उदा. लक्ष्मी किराणा",
    },
  },
} as const;

const COMMON = {
  en: { ring: "🔔 Ring me when it's ready", done: "🎉 You're in! We'll ring you first.", listed: "✓ You're on the list", addNames: "Add names", ready: "ready", fail: "Couldn't save. Please try again.", saved: "Names added" },
  mr: { ring: "🔔 तयार झाल्यावर मला कळवा", done: "🎉 झालं! सर्वात आधी आम्ही तुम्हाला कळवू.", listed: "✓ तुम्ही यादीत आहात", addNames: "नावे जोडा", ready: "तयार", fail: "सेव्ह झाले नाही. पुन्हा प्रयत्न करा.", saved: "नावे जोडली" },
};

export function ComingSoonService({
  service,
  cityId,
  cityName,
  area,
  coords,
}: {
  service: Svc;
  cityId: string | null;
  cityName: string | null;
  area?: string | null;
  coords?: { lat: number; lng: number } | null;
}) {
  const { lang } = useLanguage();
  const L = lang === "mr" ? "mr" : "en";
  const cfg = CFG[service];
  const s = cfg[L];
  const k = COMMON[L];
  const city = cityName?.split(",")[0]?.trim() || null;
  const storeKey = `bdy_demand_${cfg.demand}_${(city ?? "x").toLowerCase()}`;

  const [requestId, setRequestId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [debounced, setDebounced] = useState("");
  const [names, setNames] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [celebrate, setCelebrate] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try { setRequestId(localStorage.getItem(storeKey)); } catch { /* ignore */ }
  }, [storeKey]);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(text), 250);
    return () => clearTimeout(id);
  }, [text]);

  const { data: percent } = useQuery({
    queryKey: ["launch_progress", service, cityId],
    queryFn: async () => {
      const { data } = await supabase.rpc("app_launch_progress" as never, { _service_key: service, _city_id: cityId } as never);
      const p = Number((data as { percent?: number | null } | null)?.percent);
      return Number.isFinite(p) && p > 0 ? Math.min(100, p) : null;
    },
    staleTime: 10 * 60_000,
  });

  const { data: suggestions = [] } = useQuery({
    queryKey: ["demand_suggest", cfg.demand, city, debounced.trim().toLowerCase()],
    enabled: Boolean(city) && debounced.trim().length > 0,
    queryFn: async () => {
      const { data } = await supabase.rpc("app_demand_name_suggestions" as never, { _city: city, _service: cfg.demand, _q: debounced.trim() } as never);
      return ((data as { name: string }[] | null) ?? []).map((x) => x.name);
    },
    staleTime: 60_000,
  });

  const addName = (n: string) => {
    const v = n.trim().slice(0, 60);
    if (!v || names.length >= 3 || names.some((x) => x.toLowerCase() === v.toLowerCase())) return;
    setNames([...names, v]);
    setText("");
  };
  const pending = () => {
    const all = [...names];
    const t = text.trim();
    if (t && all.length < 3 && !all.some((x) => x.toLowerCase() === t.toLowerCase())) all.push(t.slice(0, 60));
    return all;
  };

  const remember = (id: string) => {
    setRequestId(id);
    try { localStorage.setItem(storeKey, id); } catch { /* ignore */ }
  };

  async function ring() {
    if (busy || !(await ensureSignedIn())) return;
    setBusy(true);
    const wanted = pending();
    try {
      const { data, error } = await supabase.rpc("submit_demand_request" as never, {
        _services: [cfg.demand], _city: city ?? "Unknown city", _area: area ?? null,
        _lat: coords?.lat ?? null, _lng: coords?.lng ?? null, _source: "coming-soon",
        _wanted_names: wanted.length ? wanted : null,
      } as never);
      if (error) throw error;
      const id = String((data as { id?: string } | null)?.id ?? "");
      if (id) remember(id);
      setNames([]); setText("");
      void hapticImpact("medium");
      setCelebrate((n) => n + 1);
    } catch {
      toast.error(k.fail);
    } finally {
      setBusy(false);
    }
  }

  async function addMore() {
    const wanted = pending();
    if (!requestId || wanted.length === 0 || busy) return;
    if (!(await ensureSignedIn())) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("app_demand_add_names" as never, { _request_id: requestId, _names: wanted } as never);
      if (error) throw error;
      setNames([]); setText("");
      toast.success(k.saved);
    } catch {
      toast.error(k.fail);
    } finally {
      setBusy(false);
    }
  }

  const joined = Boolean(requestId);
  const showSug = text.trim().length > 0 && names.length < 3
    ? suggestions.filter((x) => !names.some((n) => n.toLowerCase() === x.toLowerCase())).slice(0, 5)
    : [];

  return (
    <section className="mx-auto mt-4 flex max-w-sm flex-col items-center px-2 pb-10 text-center">
      {service === "food" ? <ThaliArt /> : <BasketArt />}

      <h2 className="mt-4 text-[22px] font-extrabold leading-tight text-foreground">{s.title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.line}</p>

      {percent != null && (
        <div className="mt-6 w-full">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all duration-700" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-1.5 text-xs font-bold text-primary">{Math.round(percent)}% {k.ready}</p>
        </div>
      )}

      <div className="mt-8 w-full text-left">
        <label htmlFor="cs-name" className="text-sm font-extrabold text-foreground">{s.ask}</label>
        {names.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {names.map((n) => (
              <span key={n} className="flex items-center gap-1 rounded-full bg-primary/10 py-1 pl-3 pr-1.5 text-xs font-bold text-primary">
                {n}
                <button aria-label="Remove" onClick={() => setNames(names.filter((x) => x !== n))} className="flex h-5 w-5 items-center justify-center rounded-full">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        {names.length < 3 && (
          <input
            id="cs-name" ref={inputRef} value={text} placeholder={s.ph} maxLength={60}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addName(text); } }}
            className="mt-2 w-full rounded-[14px] border border-border bg-card px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-primary"
          />
        )}
        {showSug.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {showSug.map((x) => (
              <button key={x} onClick={() => { addName(x); inputRef.current?.focus(); }}
                className="rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold text-foreground active:scale-95">
                + {x}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="relative mt-6 w-full">
        {celebrate > 0 && <Confetti key={celebrate} />}
        {joined ? (
          <>
            <div className="flex w-full items-center justify-center rounded-[18px] bg-primary/10 py-3.5 text-base font-extrabold text-primary">
              {k.listed}
            </div>
            {pending().length > 0 && (
              <button onClick={() => void addMore()} disabled={busy}
                className="mt-3 w-full rounded-[18px] border border-primary py-3 text-sm font-extrabold text-primary disabled:opacity-60">
                + {k.addNames}
              </button>
            )}
          </>
        ) : (
          <button onClick={() => void ring()} disabled={busy}
            className="w-full rounded-[18px] bg-primary py-3.5 text-base font-extrabold text-primary-foreground shadow-soft active:scale-[0.99] disabled:opacity-60">
            <span key={celebrate} className={celebrate ? "inline-block cs-bell" : "inline-block"}>{k.ring}</span>
          </button>
        )}
        {celebrate > 0 && <p className="mt-3 text-sm font-extrabold text-foreground">{k.done}</p>}
      </div>
    </section>
  );
}

function Steam() {
  return (
    <g className="text-muted-foreground" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.5">
      <path className="cs-steam" d="M70 58 q-8 -12 0 -24 q8 -12 0 -24" />
      <path className="cs-steam cs-steam-2" d="M100 52 q-8 -12 0 -24 q8 -12 0 -24" />
      <path className="cs-steam cs-steam-3" d="M130 58 q-8 -12 0 -24 q8 -12 0 -24" />
    </g>
  );
}

function ThaliArt() {
  return (
    <svg viewBox="0 0 200 160" className="h-44 w-56" aria-hidden="true">
      <Steam />
      <ellipse cx="100" cy="112" rx="88" ry="34" className="fill-muted" />
      <ellipse cx="100" cy="106" rx="82" ry="30" className="fill-card stroke-border" strokeWidth="2" />
      <ellipse cx="62" cy="98" rx="18" ry="8" className="fill-accent stroke-border" strokeWidth="1.5" />
      <ellipse cx="62" cy="96" rx="14" ry="5" fill="oklch(0.78 0.14 75)" />
      <ellipse cx="100" cy="92" rx="18" ry="8" className="fill-accent stroke-border" strokeWidth="1.5" />
      <ellipse cx="100" cy="90" rx="14" ry="5" className="fill-primary" opacity="0.75" />
      <ellipse cx="138" cy="98" rx="18" ry="8" className="fill-accent stroke-border" strokeWidth="1.5" />
      <ellipse cx="138" cy="96" rx="14" ry="5" fill="oklch(0.65 0.17 40)" />
      <ellipse cx="82" cy="118" rx="22" ry="9" fill="oklch(0.97 0.01 90)" stroke="oklch(0.88 0.02 90)" strokeWidth="1.5" />
      <circle cx="128" cy="118" r="11" fill="oklch(0.82 0.1 70)" stroke="oklch(0.7 0.1 60)" strokeWidth="1.5" />
      <circle cx="146" cy="120" r="5" fill="oklch(0.72 0.12 50)" />
    </svg>
  );
}

function BasketArt() {
  return (
    <svg viewBox="0 0 200 160" className="h-44 w-56" aria-hidden="true">
      <circle cx="78" cy="62" r="14" fill="oklch(0.65 0.17 40)" className="cs-bob" />
      <rect x="96" y="40" width="22" height="34" rx="6" className="fill-primary cs-bob cs-steam-2" opacity="0.8" />
      <circle cx="132" cy="64" r="12" fill="oklch(0.82 0.14 95)" className="cs-bob cs-steam-3" />
      <path d="M40 78 h120 l-12 52 a8 8 0 0 1 -8 6 h-80 a8 8 0 0 1 -8 -6 z" className="fill-card stroke-border" strokeWidth="2" />
      <path d="M58 92 v30 M80 92 v30 M100 92 v30 M120 92 v30 M142 92 v30" className="stroke-border" strokeWidth="2" />
      <path d="M60 78 q40 -50 80 0" fill="none" className="stroke-primary" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

function Confetti() {
  const bits = Array.from({ length: 14 }, (_, i) => i);
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 h-0" aria-hidden="true">
      {bits.map((i) => (
        <span
          key={i}
          className={`cs-confetti absolute left-1/2 top-4 h-2 w-1.5 rounded-sm ${i % 3 === 0 ? "bg-primary" : i % 3 === 1 ? "bg-accent-foreground" : "bg-muted-foreground"}`}
          style={{ "--dx": `${Math.cos((i / 14) * Math.PI * 2) * 90}px`, "--dy": `${-40 - (i % 4) * 18}px`, animationDelay: `${(i % 5) * 20}ms` } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
