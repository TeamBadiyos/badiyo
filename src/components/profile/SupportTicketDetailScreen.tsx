import { useEffect, useState } from "react";
import { ArrowLeft, Send } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getAuthUser } from "@/lib/authUser";
import { getErrorMessage } from "@/lib/errorMessage";
import { toast } from "sonner";
import {
  TICKET_CATEGORIES,
  formatStamp,
  ticketStatusClass,
  ticketStatusLabel,
  type SupportTicket,
} from "./SupportTicketsScreen";

type TicketMessage = {
  id: string;
  sender_type: string;
  body: string;
  created_at: string;
};

export function SupportTicketDetailScreen({
  ticketId,
  onBack,
}: {
  ticketId: string;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const [reply, setReply] = useState("");

  const { data } = useQuery({
    queryKey: ["support-ticket", ticketId],
    queryFn: async () => {
      const [{ data: ticket, error: tErr }, { data: messages, error: mErr }] = await Promise.all([
        supabase
          .from("support_tickets")
          .select(
            "id, subject, message, category, status, created_at, last_message_at, unread_for_customer, resolution_summary, resolved_at",
          )
          .eq("id", ticketId)
          .maybeSingle(),
        supabase
          .from("support_ticket_messages")
          .select("id, sender_type, body, created_at")
          .eq("ticket_id", ticketId)
          .order("created_at", { ascending: true }),
      ]);
      if (tErr) throw tErr;
      if (mErr) throw mErr;
      return {
        ticket: ticket as (SupportTicket & { resolution_summary: string | null; resolved_at: string | null }) | null,
        messages: (messages ?? []) as TicketMessage[],
      };
    },
    refetchInterval: 20000,
    refetchOnWindowFocus: true,
  });

  const ticket = data?.ticket ?? null;
  const messages = data?.messages ?? [];

  // Clear the "new reply" dot once the conversation is opened.
  useEffect(() => {
    if (!ticket?.unread_for_customer) return;
    supabase
      .rpc("support_mark_ticket_read", { _ticket_id: ticketId })
      .then(() => queryClient.invalidateQueries({ queryKey: ["support-tickets"] }));
  }, [ticket?.unread_for_customer, ticketId, queryClient]);

  const send = useMutation({
    mutationFn: async () => {
      const { data: userRes } = await getAuthUser();
      const uid = userRes.user?.id;
      if (!uid) throw new Error("Please sign in first.");
      const { error } = await supabase.from("support_ticket_messages").insert({
        ticket_id: ticketId,
        sender_type: "customer",
        sender_id: uid,
        body: reply.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setReply("");
      queryClient.invalidateQueries({ queryKey: ["support-ticket", ticketId] });
      queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
    },
    onError: async (e) => toast.error(await getErrorMessage(e)),
  });

  // One chat timeline: the original request, every reply, and the closing note.
  const timeline = useMemo(() => {
    type Item = { id: string; kind: "mine" | "other" | "system"; body: string; at: string };
    const items: Item[] = [];
    if (ticket && messages[0]?.body !== ticket.message) {
      items.push({ id: "original", kind: "mine", body: ticket.message, at: ticket.created_at });
    }
    for (const m of messages) {
      items.push({
        id: m.id,
        kind: m.sender_type === "customer" ? "mine" : "other",
        body: m.body,
        at: m.created_at,
      });
    }
    if (ticket?.resolution_summary) {
      items.push({
        id: "resolution",
        kind: "system",
        body: ticket.resolution_summary,
        at: ticket.resolved_at ?? ticket.last_message_at ?? ticket.created_at,
      });
    }
    return items.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }, [ticket, messages]);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [timeline.length]);

  const categoryLabel =
    TICKET_CATEGORIES.find((c) => c.value === ticket?.category)?.label ?? "Other";

  return (
    <main className="min-h-screen w-full bg-background pb-32">
      <div className="mx-auto w-full max-w-md px-5 pt-6">
        <header className="flex items-center gap-3">
          <button
            onClick={onBack}
            aria-label="Back"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card"
          >
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-bold text-foreground">
              {ticket?.subject || "Support ticket"}
            </h1>
            <p className="text-[11px] text-muted-foreground">
              #{ticketId.slice(0, 6).toUpperCase()} · {categoryLabel}
            </p>
          </div>
          {ticket && (
            <span
              className={`rounded-full px-2 py-1 text-[10px] font-bold ${ticketStatusClass(ticket.status)}`}
            >
              {ticketStatusLabel(ticket.status)}
            </span>
          )}
        </header>

        {ticket && (
          <p className="mt-4 text-center text-[11px] text-muted-foreground">
            Raised on {formatStamp(ticket.created_at)}
          </p>
        )}

        <section className="mt-4 space-y-3">
          {timeline.map((item, index) => (
            <div key={item.id} className="space-y-3">
              {dayLabel(item.at) !== (index > 0 ? dayLabel(timeline[index - 1].at) : null) && (
                <div className="flex justify-center">
                  <span className="rounded-full bg-muted px-3 py-1 text-[10px] font-bold text-muted-foreground">
                    {dayLabel(item.at)}
                  </span>
                </div>
              )}
              {item.kind === "system" ? (
                <div className="flex justify-center">
                  <p className="max-w-[90%] rounded-[12px] bg-muted px-3 py-2 text-center text-[11px] font-semibold text-muted-foreground">
                    {item.body}
                  </p>
                </div>
              ) : (
                <Bubble mine={item.kind === "mine"} body={item.body} at={item.at} />
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </section>
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-card px-5 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] pt-3">
        <div className="mx-auto flex w-full max-w-md items-end gap-2">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={1}
            maxLength={2000}
            placeholder="Write a reply…"
            className="max-h-28 min-h-[44px] flex-1 resize-none rounded-[14px] border border-border bg-background px-3 py-3 text-sm text-foreground outline-none focus:border-primary"
          />
          <button
            onClick={() => send.mutate()}
            disabled={reply.trim().length < 2 || send.isPending}
            aria-label="Send reply"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </main>
  );
}

function Bubble({ mine, body, at }: { mine: boolean; body: string; at: string }) {
  return (
    <div className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
      <span className="mb-1 text-[10px] font-semibold text-muted-foreground">
        {mine ? "You" : "badiyos Support"}
      </span>
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-[16px] px-3.5 py-2.5 text-sm shadow-sm ${
          mine
            ? "rounded-br-sm bg-primary text-primary-foreground"
            : "rounded-bl-sm border border-border bg-card text-foreground"
        }`}
      >
        {body}
      </div>
      <span className="mt-1 text-[10px] text-muted-foreground">{formatStamp(at)}</span>
    </div>
  );
}
