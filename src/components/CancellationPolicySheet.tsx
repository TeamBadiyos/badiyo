import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useLanguage } from "@/i18n";
import { useBackHandler } from "@/lib/backHandler";
import { fetchCancellationPolicy } from "@/lib/cancellation";

/** Cancellation policy from the server, in the app language. */
export function CancellationPolicySheet({ open, onClose, serviceKey }: { open: boolean; onClose: () => void; serviceKey: string }) {
  const { lang } = useLanguage();
  const mr = lang === "mr";
  useBackHandler(open, onClose);
  const { data, isPending, isError } = useQuery({
    queryKey: ["app-cancellation-policy", serviceKey],
    enabled: open,
    staleTime: 5 * 60_000,
    queryFn: () => fetchCancellationPolicy(serviceKey),
  });
  const lines = (mr && data?.lines_mr?.length ? data.lines_mr : data?.lines_en) ?? [];
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="rounded-t-[24px] px-5 pb-6 safe-bottom">
        <SheetTitle className="mt-2 text-lg font-extrabold text-foreground">{mr ? "रद्द करण्याचे धोरण" : "Cancellation policy"}</SheetTitle>
        {isPending ? (
          <Loader2 className="mx-auto mt-4 h-5 w-5 animate-spin text-primary" />
        ) : isError || lines.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{mr ? "धोरण आत्ता लोड झाले नाही. पुन्हा प्रयत्न करा." : "Couldn't load the policy. Please try again."}</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm text-foreground">
            {lines.map((x, i) => <li key={i} className="flex gap-2"><span className="text-primary">•</span>{x}</li>)}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  );
}
