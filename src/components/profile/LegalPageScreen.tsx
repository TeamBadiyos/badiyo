import { ArrowLeft, RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/i18n";

export type LegalSlug = "privacy-policy" | "terms" | "refund-policy";

type LegalPage = {
  slug: string;
  title: string;
  content: string;
  effective_date: string | null;
  last_updated_at: string;
};

async function fetchLegalPage(slug: LegalSlug): Promise<LegalPage | null> {
  const { data, error } = await supabase
    .from("legal_pages")
    .select("slug,title,content,effective_date,last_updated_at")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return data as LegalPage | null;
}

/** Minimal inline markdown → React (bold, italic, code, links). */
function renderInline(text: string, keyPrefix: string) {
  const parts: React.ReactNode[] = [];
  const re = /(\[([^\]]+)\]\(([^)]+)\))|(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\*([^*]+)\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const k = `${keyPrefix}-i${i++}`;
    if (m[1]) {
      parts.push(
        <a key={k} href={m[3]} target="_blank" rel="noreferrer" className="font-semibold text-primary underline">
          {m[2]}
        </a>,
      );
    } else if (m[4]) {
      parts.push(<strong key={k} className="font-bold text-foreground">{m[5]}</strong>);
    } else if (m[6]) {
      parts.push(<code key={k} className="rounded bg-muted px-1 py-0.5 text-xs">{m[7]}</code>);
    } else {
      parts.push(<em key={k}>{m[9]}</em>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** Minimal block-level markdown renderer (headings, lists, quotes, rules). */
function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  let para: string[] = [];
  let key = 0;

  const flushList = () => {
    if (!list.length) return;
    const items = list;
    list = [];
    blocks.push(
      <ul key={`ul-${key++}`} className="ml-5 list-disc space-y-1.5 text-sm leading-relaxed text-muted-foreground">
        {items.map((it, i) => (
          <li key={i}>{renderInline(it, `li-${key}-${i}`)}</li>
        ))}
      </ul>,
    );
  };
  const flushPara = () => {
    if (!para.length) return;
    const text = para.join(" ");
    para = [];
    blocks.push(
      <p key={`p-${key++}`} className="text-sm leading-relaxed text-muted-foreground">
        {renderInline(text, `p-${key}`)}
      </p>,
    );
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushList();
      flushPara();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushList();
      flushPara();
      const level = heading[1].length;
      const cls =
        level <= 1
          ? "mt-6 text-lg font-bold text-foreground"
          : level === 2
            ? "mt-6 text-base font-bold text-foreground"
            : "mt-4 text-sm font-bold text-foreground";
      blocks.push(
        <p key={`h-${key++}`} className={cls}>
          {renderInline(heading[2], `h-${key}`)}
        </p>,
      );
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flushList();
      flushPara();
      blocks.push(<hr key={`hr-${key++}`} className="my-4 border-border" />);
      continue;
    }
    const bullet = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) {
      flushPara();
      list.push(bullet[2]);
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flushList();
      flushPara();
      blocks.push(
        <blockquote key={`q-${key++}`} className="border-l-2 border-primary/40 pl-3 text-sm italic text-muted-foreground">
          {renderInline(quote[1], `q-${key}`)}
        </blockquote>,
      );
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushList();
  flushPara();

  return <div className="space-y-3">{blocks}</div>;
}

export function LegalPageScreen({ slug, onBack }: { slug: LegalSlug; onBack: () => void }) {
  const t = useT();
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["legal-page", slug],
    queryFn: () => fetchLegalPage(slug),
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60 * 24,
    retry: 1,
  });

  const fallbackTitle =
    slug === "privacy-policy"
      ? t("legal.privacy")
      : slug === "terms"
        ? t("legal.terms")
        : t("legal.refund");

  return (
    <main className="min-h-screen w-full bg-background pb-16">
      <div className="mx-auto w-full max-w-md px-5 pt-6">
        <header className="flex items-center gap-3">
          <button
            onClick={onBack}
            aria-label={t("common.back")}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card"
          >
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </button>
          <h1 className="min-w-0 flex-1 truncate text-lg font-bold text-foreground">
            {data?.title ?? fallbackTitle}
          </h1>
        </header>

        {isLoading && (
          <div className="mt-8 space-y-3">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-4 w-full animate-pulse rounded bg-muted" />
            ))}
          </div>
        )}

        {!isLoading && (isError || !data) && (
          <section className="mt-10 rounded-[18px] border border-border bg-card p-6 text-center">
            <p className="text-sm font-bold text-foreground">{t("legal.errorTitle")}</p>
            <p className="mt-2 text-xs text-muted-foreground">{t("legal.errorBody")}</p>
            <button
              onClick={() => void refetch()}
              className="mx-auto mt-5 flex items-center gap-2 rounded-[14px] bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground"
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              {t("legal.retry")}
            </button>
          </section>
        )}

        {!isLoading && data && (
          <>
            {(data.effective_date || data.last_updated_at) && (
              <p className="mt-4 text-xs text-muted-foreground">
                {data.effective_date
                  ? `${t("legal.effective")}: ${data.effective_date}`
                  : `${t("legal.updated")}: ${new Date(data.last_updated_at).toISOString().slice(0, 10)}`}
              </p>
            )}
            <article className="mt-4">
              <Markdown source={data.content} />
            </article>
          </>
        )}
      </div>
    </main>
  );
}
