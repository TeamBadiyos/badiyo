import { getAuthUser } from "@/lib/authUser";
/**
 * Dependency-free i18n (same pattern as the Partner App).
 *
 * - Two languages only: 'en' (default) and 'mr'.
 * - Dictionary-key files (./en.ts, ./mr.ts); missing Marathi keys fall back to English.
 * - Instant local load from localStorage, then reconcile with users.preferred_language.
 * - Digits are never localised — all numerals stay Latin (0-9).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import { en, type TranslationKey } from "./en";
import { mr } from "./mr";

export type Lang = "en" | "mr";

const STORAGE_KEY = "badiyo.lang";
const DICTS: Record<Lang, Partial<Record<TranslationKey, string>>> = { en, mr };

export type TFunction = (
  key: TranslationKey,
  params?: Record<string, string | number>,
) => string;

type Ctx = {
  lang: Lang;
  t: TFunction;
  setLang: (lang: Lang) => Promise<void>;
};

const LanguageContext = createContext<Ctx | null>(null);

function readLocalLang(): Lang {
  if (typeof window === "undefined") return "en";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "mr" ? "mr" : "en";
  } catch {
    return "en";
  }
}

function interpolate(template: string, params?: Record<string, string | number>) {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, k: string) =>
    params[k] === undefined ? m : String(params[k]),
  );
}

export function makeT(lang: Lang): TFunction {
  const dict = DICTS[lang] ?? en;
  return (key, params) =>
    interpolate((dict[key] as string | undefined) ?? en[key] ?? key, params);
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  // Instant: whatever was last used on this device.
  const [lang, setLangState] = useState<Lang>(readLocalLang);

  // Reconcile with the signed-in user's stored preference.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: userData } = await getAuthUser();
        const uid = userData.user?.id;
        if (!uid) return;
        const { data } = await supabase
          .from("users")
          .select("preferred_language")
          .eq("id", uid)
          .maybeSingle();
        const remote = (data as { preferred_language?: string } | null)
          ?.preferred_language;
        if (cancelled || (remote !== "en" && remote !== "mr")) return;
        setLangState(remote);
        try {
          window.localStorage.setItem(STORAGE_KEY, remote);
        } catch {
          /* ignore */
        }
      } catch {
        /* offline / signed out — keep the local value */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setLang = useCallback(async (next: Lang) => {
    setLangState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    const { data: userData } = await getAuthUser();
    if (!userData.user?.id) return;
    const { error } = await supabase.rpc("customer_set_language", { _lang: next });
    if (error) throw error;
  }, []);

  const value = useMemo<Ctx>(
    () => ({ lang, t: makeT(lang), setLang }),
    [lang, setLang],
  );

  return (
    <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
  );
}

function useLanguageContext(): Ctx {
  const ctx = useContext(LanguageContext);
  // Safe fallback so components still render outside the provider (e.g. tests).
  return ctx ?? { lang: "en", t: makeT("en"), setLang: async () => {} };
}

/** Returns the translate function. */
export function useT(): TFunction {
  return useLanguageContext().t;
}

/** Returns the current language plus a setter that persists to the DB. */
export function useLanguage() {
  const { lang, setLang } = useLanguageContext();
  return { lang, setLang };
}
