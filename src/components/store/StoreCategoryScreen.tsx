import { ArrowLeft } from "lucide-react";
import { useT } from "@/i18n";
import type { PublicStore } from "@/lib/store";
import { StoreRow } from "./StoreRow";
import { StoreOrderingBar } from "./StoreOrderingBar";
import type { StoreCategoryGroup } from "./storeGroups";

export type { StoreCategoryGroup } from "./storeGroups";

/** Full list of one category's shops, same row format as the Store tab. */
export function StoreCategoryScreen({
  group,
  onBack,
  onOpenStore,
}: {
  coords: { lat: number; lng: number } | null;
  group: StoreCategoryGroup;
  onBack: () => void;
  onOpenStore: (s: PublicStore) => void;
}) {
  const t = useT();
  return (
    <main className="min-h-screen w-full bg-background pb-32 momentum-scroll">
      <div className="mx-auto w-full max-w-md px-5 pt-2">
        <header
          className="bleed-safe-top sticky top-0 z-30 -mx-5 flex items-center gap-3 bg-background px-5 pb-3"
          style={{ "--bleed-top-extra": "16px" } as React.CSSProperties}
        >
          <button
            type="button"
            onClick={onBack}
            aria-label={t("common.back")}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-card"
          >
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </button>
          <p className="truncate text-base font-bold text-foreground">{group.category.name}</p>
        </header>
        <ul className="mt-2 space-y-3">
          {group.stores.map((r) => (
            <li key={r.store.id}>
              <StoreRow store={r.store} km={r.km} products={r.products} onOpen={() => onOpenStore(r.store)} />
            </li>
          ))}
        </ul>
      </div>
      <StoreOrderingBar />
    </main>
  );
}
