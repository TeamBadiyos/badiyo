-- 1. RLS: online experts can see broadcasts regardless of GPS staleness, and
--    up to the radius the dispatcher is actually searching at.
DROP POLICY IF EXISTS "Online experts can view nearby broadcast bookings" ON public.bookings;

CREATE POLICY "Online experts can view nearby broadcast bookings"
ON public.bookings
FOR SELECT
USING (
  assigned_expert_id IS NULL
  AND status = 'accepted'
  AND EXISTS (
    SELECT 1
    FROM public.experts e
    WHERE e.auth_user_id = auth.uid()
      AND e.is_online = true
      AND e.status = 'active'
      AND (
        (
          e.current_lat IS NOT NULL AND e.current_lng IS NOT NULL
          AND bookings.booking_lat IS NOT NULL AND bookings.booking_lng IS NOT NULL
          AND public.haversine_km(e.current_lat, e.current_lng, bookings.booking_lat, bookings.booking_lng)
              <= GREATEST(
                   COALESCE(bookings.current_search_radius_km, 0),
                   COALESCE((SELECT broadcast_radius_km FROM public.dispatch_config LIMIT 1), 5)
                 )
        )
        OR (e.zone_id IS NOT NULL AND bookings.zone_id IS NOT NULL AND e.zone_id = bookings.zone_id)
      )
      AND (
        bookings.service_category_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.partner_skills ps
          WHERE ps.expert_id = e.id
            AND ps.status = 'approved'
            AND ps.service_category_id = bookings.service_category_id
        )
      )
  )
);

-- 2. Stop marking bookings "dispatch exhausted" a few minutes after broadcast.
--    Keep them open for the configured no_expert_timeout_minutes window.
CREATE OR REPLACE FUNCTION public.expand_stale_broadcasts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare cfg record; b record; _new_radius numeric; _expanded integer := 0;
begin
  select * into cfg from public.dispatch_config limit 1;
  if cfg.id is null then return 0; end if;

  for b in
    select id, coalesce(current_search_radius_km, cfg.broadcast_radius_km) as radius
    from public.bookings
    where status = 'accepted' and assigned_expert_id is null and deleted_at is null
      and broadcast_started_at is not null
      and broadcast_started_at < now() - make_interval(secs => cfg.radius_expand_after_seconds)
      and coalesce(current_search_radius_km, cfg.broadcast_radius_km) < cfg.radius_expand_max_km
  loop
    _new_radius := least(b.radius + cfg.radius_expand_step_km, cfg.radius_expand_max_km);
    perform set_config('app.booking_bypass','on', true);
    update public.bookings set current_search_radius_km = _new_radius where id = b.id;
    perform set_config('app.booking_bypass','off', true);
    perform public.broadcast_booking_to_experts(b.id, _new_radius);
    _expanded := _expanded + 1;
  end loop;

  -- Only exhaust after the full no-expert timeout window, not right after the
  -- radius hits its maximum (which used to happen ~3-4 minutes in).
  perform set_config('app.booking_bypass','on', true);
  update public.bookings set dispatch_exhausted_at = now()
   where status = 'accepted' and assigned_expert_id is null and deleted_at is null
     and dispatch_exhausted_at is null and broadcast_started_at is not null
     and broadcast_started_at < now()
         - make_interval(mins => greatest(coalesce(cfg.no_expert_timeout_minutes, 30), 1))
     and coalesce(current_search_radius_km, cfg.broadcast_radius_km) >= cfg.radius_expand_max_km;
  perform set_config('app.booking_bypass','off', true);

  for b in
    select id from public.bookings
     where deleted_at is null and dispatch_alert_sent = false
       and dispatch_exhausted_at is not null and assigned_expert_id is null
       and status in ('accepted','confirmed','pending')
  loop
    perform public.notify_customer_alert(
      b.id, 'no_expert_found', 'Still looking for an expert',
      'No expert is available near you right now. We are still trying — you can also cancel for a full refund.',
      jsonb_build_object('route', 'booking/' || b.id::text));
    perform set_config('app.booking_bypass','on', true);
    update public.bookings set dispatch_alert_sent = true where id = b.id;
    perform set_config('app.booking_bypass','off', true);
  end loop;
  return _expanded;
end
$$;

-- 3. Auto-heal the expert busy flag whenever a booking leaves an active state
--    or is unassigned.
CREATE OR REPLACE FUNCTION public.bookings_sync_expert_busy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare _e uuid;
begin
  foreach _e in array array_remove(array[OLD.assigned_expert_id, NEW.assigned_expert_id], null)
  loop
    update public.experts x
       set is_busy = exists (
             select 1 from public.bookings b
              where b.assigned_expert_id = x.id
                and b.deleted_at is null
                and b.status in ('expert_assigned','on_the_way','arrived','in_progress')
           )
           or exists (
             select 1 from public.courier_orders c
              where c.assigned_expert_id = x.id
                and c.status in ('DRIVER_ASSIGNED','ARRIVED_PICKUP','PICKED_UP','IN_TRANSIT')
           )
     where x.id = _e;
  end loop;
  return null;
exception when others then
  raise warning '[bookings_sync_expert_busy] %', SQLERRM;
  return null;
end
$$;

DROP TRIGGER IF EXISTS trg_bookings_sync_expert_busy ON public.bookings;
CREATE TRIGGER trg_bookings_sync_expert_busy
AFTER UPDATE OF status, assigned_expert_id, deleted_at ON public.bookings
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status
      OR OLD.assigned_expert_id IS DISTINCT FROM NEW.assigned_expert_id
      OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at)
EXECUTE FUNCTION public.bookings_sync_expert_busy();
