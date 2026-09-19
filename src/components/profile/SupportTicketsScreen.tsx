import { useMemo, useState } from "react";
import { ArrowLeft, MessageCircle, Plus, ChevronRight } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getAuthUser } from "@/lib/authUser";
import { getErrorMessage } from "@/lib/errorMessage";
import { toast } from "sonner";

export type SupportTicket = {
  id: string;
  subject: string | null;
  message: string;
  category: string;
  status: string;
  created_at: string;
  last_message_at: string;
  unread_for_customer: boolean;
};

export const TICKET_CATEGORIES: { value: string; label: string }[] = [
  { value: "booking", label: "Booking" },
  { value: "payment", label: "Payment / Refund" },
  { value: "service", label: "Expert / Service quality" },
  { value: "app", label: "App issue" },
  { value: "other", label: "Other" },
];

export function ticketStatusLabel(status: string) {
  switch (status) {
    case "answered":
      return "Answered";
    case "in_progress":
      return "In progress";
    case "resolved":
      return "Resolved";
    default:
      return "Open";
  }
}

export function ticketStatusClass(status: string) {
  switch (status) {
    case "answered":
      return "bg-primary/10 text-primary";
    case "resolved":
      return "bg-muted text-muted-foreground";
    case "in_progress":
      return "bg-amber-500/10 text-amber-600";
    default:
      return "bg-blue-500/10 text-blue-600";
  }
}

export function formatStamp(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function fetchTickets(): Promise<SupportTicket[]> {
  const { data: userRes } = await getAuthUser();
  const uid = userRes.user?.id;
  if (!uid) return [];
  const { data, error } = await supabase
    .from("support_tickets")
    .select("id, subject, message, category, status, created_at, last_message_at, unread_for_customer")
    .eq("user_id", uid)
    .order("last_message_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as SupportTicket[];
}

export function SupportTicketsScreen({
  onBack,
  onOpenTicket,
}: {
  onBack: () => void;
  onOpenTicket: (ticketId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [composing, setComposing] = useState(false);
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("booking");
  const [message, setMessage] = useState("");

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ["support-tickets"],
    queryFn: fetchTickets,
    refetchInterval: 20000,
    refetchOnWindowFocus: true,
  });

  const create = useMutation({
    mutationFn: async () => {
      const { data: userRes } = await getAuthUser();
      const uid = userRes.user?.id;
      if (!uid) throw new Error("Please sign in to raise a ticket.");
      const body = message.trim();
      const { data, error } = await supabase
        .from("support_tickets")
        .insert({
          user_id: uid,
          message: body,
          subject: subject.trim() || body.slice(0, 60),
          category,
        })
        .select("id")
        .single();
      if (error) throw error;
      const { error: msgErr } = await supabase.from("support_ticket_messages").insert({
        ticket_id: data.id,
        sender_type: "customer",
        sender_id: uid,
        body,
      });
      if (msgErr) throw msgErr;
      return data.id as string;
    },
    onSuccess: (id) => {
      setComposing(false);
      setSubject("");
      setMessage("");
      setCategory("booking");
      queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
      toast.success("Ticket raised — we'll reply here");
      onOpenTicket(id);
    },
    onError: async (e) => toast.error(await getErrorMessage(e)),
  });

  const canSubmit = useMemo(
    () => message.trim().length >= 5 && !create.isPending,
    [message, create.isPending],
  );

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
          <h1 className="text-lg font-bold text-foreground">My tickets</h1>
        </header>

        {composing ? (
          <section className="mt-5 rounded-[18px] border border-border bg-card p-4 shadow-sm">
            <p className="text-sm font-bold text-foreground">Raise a new ticket</p>

            <label className="mt-4 block text-xs font-semibold text-muted-foreground">
              What is it about?
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              {TICKET_CATEGORIES.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setCategory(c.value)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    category === c.value
                      ? "bg-primary text-primary-foreground"
                      : "border border-border bg-background text-muted-foreground"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>

            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={80}
              placeholder="Subject (optional)"
              className="mt-4 h-11 w-full rounded-[14px] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
            />
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              maxLength={2000}
              placeholder="Tell us what happened…"
              className="mt-3 w-full resize-none rounded-[14px] border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
            />
            <button
              onClick={() => create.mutate()}
              disabled={!canSubmit}
              className="mt-3 w-full rounded-[14px] bg-primary px-4 py-3 text-sm font-bold text-primary-foreground disabled:opacity-50"
            >
              {create.isPending ? "Submitting…" : "Submit ticket"}
            </button>
            <button
              onClick={() => setComposing(false)}
              className="mt-2 w-full py-2 text-xs font-semibold text-muted-foreground"
            >
              Cancel
            </button>
          </section>
        ) : (
          <button
            onClick={() => setComposing(true)}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-[14px] bg-primary px-4 py-3 text-sm font-bold text-primary-foreground active:scale-[0.99]"
          >
            <Plus className="h-4 w-4" /> Raise a new ticket
          </button>
        )}

        <section className="mt-6 space-y-3">
          {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
          {!isLoading && tickets.length === 0 && (
            <div className="flex flex-col items-center rounded-[18px] border border-border bg-card p-8 text-center shadow-sm">
              <MessageCircle className="h-7 w-7 text-muted-foreground" />
              <p className="mt-3 text-sm font-bold text-foreground">No tickets yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Raise a ticket and our team will reply right here.
              </p>
            </div>
          )}
          {tickets.map((t) => (
            <button
              key={t.id}
              onClick={() => onOpenTicket(t.id)}
              className="flex w-full items-center gap-3 rounded-[18px] border border-border bg-card p-4 text-left shadow-sm transition active:bg-muted/40"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm font-bold text-foreground">
                    {t.subject || t.message.slice(0, 50)}
                  </p>
                  {t.unread_for_customer && (
                    <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                  )}
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{t.message}</p>
                <div className="mt-2 flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${ticketStatusClass(t.status)}`}
                  >
                    {ticketStatusLabel(t.status)}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {formatStamp(t.last_message_at)}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    #{t.id.slice(0, 6).toUpperCase()}
                  </span>
                </div>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </section>
      </div>
    </main>
  );
}
