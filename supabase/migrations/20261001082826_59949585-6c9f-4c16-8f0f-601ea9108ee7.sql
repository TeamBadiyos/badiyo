-- Clear stuck busy flags for experts with no active booking and no active courier order
UPDATE public.experts e
SET is_busy = false
WHERE coalesce(e.is_busy, false) = true
  AND NOT EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.assigned_expert_id = e.id
      AND b.status IN ('expert_assigned','on_the_way','arrived','in_progress')
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.courier_orders c
    WHERE c.assigned_expert_id = e.id
      AND c.status NOT IN ('delivered','cancelled','completed','refunded','failed')
  );
