import { MessageCircle, Phone, Store } from "lucide-react";
import { useT } from "@/i18n";
import { SELL_ON_BADIYOS, sellCallHref, sellWhatsAppHref } from "@/lib/store";

/** Compact "Sell on badiyos" card shown above the Store tab list. */
export function SellOnBadiyosCard() {
  const t = useT();
  return (
    <div className="flex items-center gap-2.5 rounded-[14px] bg-primary/8 px-3 py-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <Store className="h-4.5 w-4.5 text-primary" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-bold leading-snug text-foreground">
          {t("store.sell.title")}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {t("store.sell.line")}
        </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <a
            href={sellCallHref()}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/30 bg-card px-3.5 text-xs font-bold text-primary"
          >
            <Phone className="h-3.5 w-3.5" />
            {t("store.sell.call")}
          </a>
          <a
            href={sellWhatsAppHref()}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-8 items-center gap-1 rounded-full bg-primary px-3 text-xs font-bold text-primary-foreground"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            {t("store.sell.whatsapp")}
          </a>
      </div>
    </div>
  );
}
