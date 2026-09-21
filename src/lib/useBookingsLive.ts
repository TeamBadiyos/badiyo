import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getAuthUser } from "@/lib/authUser";
import { ACTIVE_BOOKING_KEY } from "@/lib/liveService";

/**
 * Keeps the customer's booking list fresh in near real-time.
 * Any insert/update on the user's bookings (including a status change made
 * from the Command Center) invalidates the ["my-bookings"] cache instantly.
 */
export function useBookingsLive() {
  const qc = useQueryClient();

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    (async () => {
      const { data } = await getAuthUser();
      const uid = data.user?.id;
      if (!uid || cancelled) return;

      const refresh = () => {
        qc.invalidateQueries({ queryKey: ["my-bookings"] });
        qc.invalidateQueries({ queryKey: ACTIVE_BOOKING_KEY });
      };

      channel = supabase
        .channel(`my-bookings-${uid}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "bookings", filter: `user_id=eq.${uid}` },
          refresh,
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [qc]);
}
