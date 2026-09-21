import { useQuery } from "@tanstack/react-query";
import { Ticket, Megaphone, Copy } from "lucide-react";
import { toast } from "sonner";
import {
  fetchMyCoupons,
  fetchCampaignOffers,
  couponValueLabel,
  type MyCoupon,
} from "@/lib/coupons";

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

async function copyCode(code: string) {
  try {
    await navigator.clipboard.writeText(code);
    toast.success(`${code} copied — apply it at checkout`);
  } catch {
    toast(`Your code is ${code}`);
  }
}

function CouponCard({ c }: { c: MyCoupon }) {
  return (
    <div className="rounded-[18px] border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-foreground">{c.title || c.code}</p>
          {c.description && (
            <p className="mt-0.5 text-xs text-muted-foreground">{c.description}</p>
          )}
          {Number(c.min_order_amount) > 0 && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              On bookings above ₹{Number(c.min_order_amount)}
            </p>
          )}
          {c.valid_until && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Valid till {formatDate(c.valid_until)}
            </p>
          )}
        </div>
        <span className="shrink-0 rounded-full bg-primary/10 px-2 py-1 text-xs font-bold text-primary">
          {couponValueLabel(c)}
        </span>
      </div>
      <button
        type="button"
        onClick={() => void copyCode(c.code)}
        className="mt-3 flex w-full items-center justify-between rounded-[14px] border border-dashed border-primary/50 bg-primary/5 px-4 py-2.5"
      >
        <span className="text-sm font-extrabold uppercase tracking-wider text-primary">
          {c.code}
        </span>
        <span className="flex items-center gap-1 text-xs font-bold text-primary">
          <Copy className="h-3.5 w-3.5" /> Copy
        </span>
      </button>
      {c.is_personal && (
        <p className="mt-2 text-[11px] font-bold uppercase tracking-wide text-primary/80">
          Earned reward · just for you
        </p>
      )}
    </div>
  );
}

export function OffersList() {
  const { data: coupons, isLoading } = useQuery({
    queryKey: ["my_coupons"],
    queryFn: () => fetchMyCoupons(),
    staleTime: 60_000,
  });
  const { data: campaigns } = useQuery({
    queryKey: ["campaign_offers"],
    queryFn: fetchCampaignOffers,
    staleTime: 60_000,
  });

  const list = coupons ?? [];
  const news = campaigns ?? [];

  return (
    <div className="mt-5 space-y-3">
      {news.map((c) => (
        <div
          key={c.id}
          className="overflow-hidden rounded-[18px] border border-border bg-card shadow-sm"
        >
          {c.image_url && (
            <img
              src={c.image_url}
              alt={c.title}
              className="h-32 w-full object-cover"
              loading="lazy"
            />
          )}
          <div className="flex items-start gap-3 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Megaphone className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-foreground">{c.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{c.body}</p>
            </div>
          </div>
        </div>
      ))}

      {isLoading && <p className="text-sm text-muted-foreground">Loading offers…</p>}

      {!isLoading && list.length === 0 && news.length === 0 && (
        <div className="flex items-start gap-3 rounded-[18px] border border-border bg-card p-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <Ticket className="h-5 w-5 text-primary" />
          </div>
          <p className="text-xs text-muted-foreground">
            No offers right now. Invite friends to unlock reward coupons.
          </p>
        </div>
      )}

      {list.map((c) => (
        <CouponCard key={c.id} c={c} />
      ))}
    </div>
  );
}
