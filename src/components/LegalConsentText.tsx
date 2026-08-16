import { useT } from "@/i18n";
import type { LegalSlug } from "@/components/profile/LegalPageScreen";

export function LegalConsentText({
  onOpenLegal,
  className = "",
}: {
  onOpenLegal?: (slug: LegalSlug) => void;
  className?: string;
}) {
  const t = useT();
  return (
    <p className={`text-center text-xs text-muted-foreground ${className}`}>
      {t("legal.agreePrefix")}
      <button
        type="button"
        onClick={() => onOpenLegal?.("terms")}
        className="font-semibold text-primary underline underline-offset-2"
      >
        {t("legal.terms")}
      </button>
      {t("legal.agreeAnd")}
      <button
        type="button"
        onClick={() => onOpenLegal?.("privacy-policy")}
        className="font-semibold text-primary underline underline-offset-2"
      >
        {t("legal.privacy")}
      </button>
      {t("legal.agreeSuffix")}
    </p>
  );
}
