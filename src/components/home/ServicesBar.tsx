import type { Segment } from "@/lib/segments";
import { useLanguage, useT } from "@/i18n";
import { translateCatalog } from "@/lib/catalogI18n";

export function ServicesBar({
  segments,
  activeSegmentId,
  onSelect,
}: {
  segments: Segment[];
  activeSegmentId: string | null;
  onSelect: (segmentId: string | null) => void;
}) {
  const t = useT();
  const { lang } = useLanguage();
  const tabs: { id: string | null; label: string }[] = [
    { id: null, label: t("home.tabAll") },
    ...segments.map((s) => ({
      id: s.id,
      label: translateCatalog(s.short_name || s.name, lang),
    })),
  ];

  return (
    <nav
      aria-label={t("home.servicesBar")}
      className="-mx-5 mt-3 overflow-x-auto px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <div className="flex w-max items-center gap-2">
        {tabs.map((t) => {
          const active = t.id === activeSegmentId;
          return (
            <button
              key={t.id ?? "all"}
              onClick={() => onSelect(t.id)}
              aria-current={active ? "page" : undefined}
              className={
                "shrink-0 rounded-full px-4 py-1.5 text-sm font-bold transition active:scale-[0.98] " +
                (active
                  ? "bg-primary text-primary-foreground"
                  : "border border-border bg-card text-foreground")
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
