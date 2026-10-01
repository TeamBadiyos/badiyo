import { useRef, useState } from "react";
import { ArrowLeft, ImagePlus, X } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getAuthUser } from "@/lib/authUser";
import { useLanguage } from "@/i18n";

const MAX = 1000;

const CATEGORIES = [
  { value: "app", en: "App", mr: "ॲप" },
  { value: "service_quality", en: "Service quality", mr: "सेवेची गुणवत्ता" },
  { value: "new_service", en: "Nayi service ka idea", mr: "नवीन सेवेची कल्पना" },
  { value: "price", en: "Price", mr: "किंमत" },
  { value: "other", en: "Other", mr: "इतर" },
] as const;

const TXT = {
  en: {
    title: "💡 Suggestion dein",
    newTab: "Naya suggestion",
    mineTab: "Mere suggestions",
    category: "Category",
    placeholder: "Apna suggestion likhiye…",
    photo: "Photo jodein (optional)",
    send: "Bhejo",
    sending: "Bhej rahe hain…",
    success: "Shukriya! Aapka suggestion hamari team tak pahunch gaya 🙏",
    limit: "Aaj ke liye limit poori ho gayi, kal phir bhejein",
    required: "Kripya apna suggestion likhiye",
    failed: "Suggestion nahi bheja ja saka. Phir try karein.",
    empty: "Abhi tak koi suggestion nahi bheja.",
    loading: "Load ho raha hai…",
  },
  mr: {
    title: "💡 सूचना द्या",
    newTab: "नवीन सूचना",
    mineTab: "माझ्या सूचना",
    category: "प्रकार",
    placeholder: "तुमची सूचना लिहा…",
    photo: "फोटो जोडा (ऐच्छिक)",
    send: "पाठवा",
    sending: "पाठवत आहोत…",
    success: "धन्यवाद! तुमची सूचना आमच्या टीमपर्यंत पोहोचली 🙏",
    limit: "आजची मर्यादा पूर्ण झाली, उद्या पुन्हा पाठवा",
    required: "कृपया तुमची सूचना लिहा",
    failed: "सूचना पाठवता आली नाही. पुन्हा प्रयत्न करा.",
    empty: "अजून कोणतीही सूचना पाठवलेली नाही.",
    loading: "लोड होत आहे…",
  },
};

type Row = {
  id: string;
  text: string;
  category: string;
  created_at: string;
  suggestion_statuses: {
    customer_label_en: string | null;
    customer_label_mr: string | null;
    label: string;
    color: string | null;
  } | null;
};

async function fetchMine(): Promise<Row[]> {
  const { data: u } = await getAuthUser();
  const uid = u.user?.id;
  if (!uid) return [];
  const { data, error } = await supabase
    .from("suggestions")
    .select("id, text, category, created_at, suggestion_statuses(customer_label_en, customer_label_mr, label, color)")
    .eq("user_id", uid)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as unknown as Row[];
}

export function SuggestionsScreen({ onBack }: { onBack: () => void }) {
  const { lang } = useLanguage();
  const L = lang === "mr" ? TXT.mr : TXT.en;
  const qc = useQueryClient();
  const [tab, setTab] = useState<"new" | "mine">("new");
  const [category, setCategory] = useState<string>("app");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: rows = [], isLoading } = useQuery({ queryKey: ["my-suggestions"], queryFn: fetchMine });

  const send = useMutation({
    mutationFn: async () => {
      const body = text.trim();
      if (!body) throw new Error("__required");
      const { data: u } = await getAuthUser();
      const uid = u.user?.id;
      if (!uid) throw new Error("__failed");
      let photo_path: string | null = null;
      if (file) {
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        const path = `${uid}/${Date.now()}.${ext}`;
        const { error } = await supabase.storage
          .from("suggestion-media")
          .upload(path, file, { contentType: file.type });
        if (error) throw error;
        photo_path = path;
      }
      const { error } = await supabase
        .from("suggestions")
        .insert({ user_id: uid, category, text: body.slice(0, MAX), photo_path });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(L.success);
      setText("");
      setFile(null);
      setErr(null);
      qc.invalidateQueries({ queryKey: ["my-suggestions"] });
      setTab("mine");
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? "");
      if (msg === "__required") return setErr(L.required);
      if (/per day|5 suggestions/i.test(msg)) {
        setErr(L.limit);
        return toast.error(L.limit);
      }
      setErr(L.failed);
    },
  });

  const catLabel = (v: string) => {
    const c = CATEGORIES.find((x) => x.value === v);
    return c ? (lang === "mr" ? c.mr : c.en) : v;
  };

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
          <h1 className="text-lg font-bold text-foreground">{L.title}</h1>
        </header>

        <div className="mt-5 grid grid-cols-2 gap-1 rounded-full border border-border bg-card p-1">
          {(["new", "mine"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`rounded-full py-2 text-sm font-semibold transition ${
                tab === k ? "bg-primary text-primary-foreground" : "text-muted-foreground"
              }`}
            >
              {k === "new" ? L.newTab : `${L.mineTab}${rows.length ? ` (${rows.length})` : ""}`}
            </button>
          ))}
        </div>

        {tab === "new" ? (
          <section className="mt-5 space-y-4 rounded-[18px] border border-border bg-card p-4 shadow-sm">
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">{L.category}</p>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => setCategory(c.value)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                      category === c.value
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-foreground"
                    }`}
                  >
                    {lang === "mr" ? c.mr : c.en}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <textarea
                value={text}
                maxLength={MAX}
                onChange={(e) => {
                  setText(e.target.value);
                  setErr(null);
                }}
                rows={6}
                placeholder={L.placeholder}
                className="w-full resize-none rounded-[12px] border border-border bg-background p-3 text-sm text-foreground outline-none focus:border-primary"
              />
              <p className="mt-1 text-right text-[11px] text-muted-foreground">
                {text.length}/{MAX}
              </p>
            </div>

            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {file ? (
              <div className="flex items-center gap-3 rounded-[12px] border border-border p-2">
                <img src={URL.createObjectURL(file)} alt="" className="h-14 w-14 rounded-md object-cover" />
                <p className="min-w-0 flex-1 truncate text-xs text-foreground">{file.name}</p>
                <button onClick={() => setFile(null)} aria-label="Remove photo" className="p-1">
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileRef.current?.click()}
                className="flex w-full items-center justify-center gap-2 rounded-[12px] border border-dashed border-border py-3 text-sm text-muted-foreground"
              >
                <ImagePlus className="h-4 w-4" /> {L.photo}
              </button>
            )}

            {err && <p className="text-sm font-medium text-destructive">{err}</p>}

            <button
              onClick={() => send.mutate()}
              disabled={send.isPending || !text.trim()}
              className="w-full rounded-full bg-primary py-3 text-sm font-bold text-primary-foreground disabled:opacity-50"
            >
              {send.isPending ? L.sending : L.send}
            </button>
          </section>
        ) : (
          <section className="mt-5 space-y-3">
            {isLoading ? (
              <p className="text-center text-sm text-muted-foreground">{L.loading}</p>
            ) : rows.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">{L.empty}</p>
            ) : (
              rows.map((r) => {
                const st = r.suggestion_statuses;
                const label = st ? (lang === "mr" ? st.customer_label_mr : st.customer_label_en) || st.label : "";
                const color = st?.color || "#6B7280";
                return (
                  <article key={r.id} className="rounded-[14px] border border-border bg-card p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-muted-foreground">{catLabel(r.category)}</span>
                      {st && (
                        <span
                          className="rounded-full px-2 py-0.5 text-[11px] font-bold"
                          style={{ color, backgroundColor: `${color}1A` }}
                        >
                          {label}
                        </span>
                      )}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground">{r.text}</p>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      {new Date(r.created_at).toLocaleDateString(lang === "mr" ? "mr-IN-u-nu-latn" : "en-IN", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </p>
                  </article>
                );
              })
            )}
          </section>
        )}
      </div>
    </main>
  );
}
