-- 1. estimated_minutes on service_price_options
ALTER TABLE public.service_price_options
  ADD COLUMN IF NOT EXISTS estimated_minutes integer;

COMMENT ON COLUMN public.service_price_options.estimated_minutes IS
  'Internal expected service length in minutes. Used for service_end_at, is_busy and slot-fit checks. Never shown to customers for flat-priced services.';

UPDATE public.service_price_options
   SET estimated_minutes = duration_minutes
 WHERE estimated_minutes IS NULL AND duration_minutes IS NOT NULL;

UPDATE public.service_price_options SET estimated_minutes = 60
 WHERE id = '822a460f-5a69-4c5f-9c83-3bd45afb8fe8';
UPDATE public.service_price_options SET estimated_minutes = 60
 WHERE id = 'e255955b-f147-4922-a2b8-42ea5af8737f';
UPDATE public.service_price_options SET estimated_minutes = 90
 WHERE id = 'd5085690-da21-4b72-8aa0-05dc5d3a2d8b';

-- 2. bookings.price_option_id
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS price_option_id uuid REFERENCES public.service_price_options(id);

CREATE INDEX IF NOT EXISTS idx_bookings_price_option_id ON public.bookings(price_option_id);

-- 3. fallback log
CREATE TABLE IF NOT EXISTS public.booking_price_fallback_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid,
  service_label text,
  service_category_id uuid,
  matched_price_option_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.booking_price_fallback_log TO authenticated;
GRANT ALL ON public.booking_price_fallback_log TO service_role;
ALTER TABLE public.booking_price_fallback_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff read booking price fallback log" ON public.booking_price_fallback_log;
CREATE POLICY "staff read booking price fallback log"
  ON public.booking_price_fallback_log FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), array['super_admin','ops_manager']));

-- 4. bookings_before_insert: price and duration strictly from service_price_options
CREATE OR REPLACE FUNCTION public.bookings_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
declare
  _bypass text;
  _gst numeric;
  _allow jsonb;
  _spo record;
  _matches int;
  _used_fallback boolean := false;
  _duration int;
  _addr_lat numeric;
  _addr_lng numeric;
begin
  begin _bypass := current_setting('app.booking_bypass', true); exception when others then _bypass := null; end;

  -- Resolve the catalogue item FIRST: it is the only source of price and duration.
  if NEW.price_option_id is not null then
    select spo.id, spo.customer_price, spo.estimated_minutes, spo.duration_minutes,
           spo.label, s.category_id
      into _spo
      from public.service_price_options spo
      join public.services s on s.id = spo.service_id
     where spo.id = NEW.price_option_id
       and spo.is_active = true
       and s.is_active = true;

    if _spo.id is null then
      raise exception 'SERVICE_OPTION_NOT_AVAILABLE'
        using errcode = 'check_violation',
              hint = 'The selected service option no longer exists or is inactive.';
    end if;
  else
    -- Legacy clients: match by label, but ONLY within one service.
    select count(*) into _matches
      from public.service_price_options spo
      join public.services s on s.id = spo.service_id
     where spo.is_active = true
       and s.is_active = true
       and lower(btrim(spo.label)) = lower(btrim(coalesce(NEW.service_label, '')))
       and (NEW.service_category_id is null or s.category_id = NEW.service_category_id);

    if _matches <> 1 then
      raise exception 'SERVICE_OPTION_AMBIGUOUS:%', coalesce(NEW.service_label, '')
        using errcode = 'check_violation',
              hint = 'Please update the app and select the service again.';
    end if;

    select spo.id, spo.customer_price, spo.estimated_minutes, spo.duration_minutes,
           spo.label, s.category_id
      into _spo
      from public.service_price_options spo
      join public.services s on s.id = spo.service_id
     where spo.is_active = true
       and s.is_active = true
       and lower(btrim(spo.label)) = lower(btrim(coalesce(NEW.service_label, '')))
       and (NEW.service_category_id is null or s.category_id = NEW.service_category_id);

    _used_fallback := true;
    NEW.price_option_id := _spo.id;
  end if;

  _duration := coalesce(_spo.estimated_minutes, _spo.duration_minutes);
  if _duration is null or _duration <= 0 then
    raise exception 'SERVICE_DURATION_NOT_CONFIGURED:%', _spo.label
      using errcode = 'check_violation',
            hint = 'Set estimated_minutes for this service option in the Command Center.';
  end if;

  NEW.price := _spo.customer_price;
  NEW.service_duration_minutes := _duration;
  NEW.service_label := coalesce(NEW.service_label, _spo.label);
  if NEW.service_category_id is null then
    NEW.service_category_id := _spo.category_id;
  end if;

  -- Service status + hours check (new bookings only; rescue/bypass exempt)
  if not public.service_hours_bypass() then
    _allow := public.service_slot_allowed('clean', NEW.scheduled_date, NEW.scheduled_time_slot, _duration);
    if not coalesce((_allow->>'ok')::boolean, true) then
      raise exception 'SERVICE_CLOSED:%:%', _allow->>'reason_code', coalesce(_allow->>'next_open_at', '')
        using errcode = 'check_violation';
    end if;
  end if;

  _gst := coalesce(public.get_gst_percent(), 0);
  if _gst < 0 or _gst > 100 then _gst := 0; end if;
  NEW.gst_percent := _gst;
  NEW.gst_amount := round(NEW.price * _gst / 100.0, 2);
  NEW.total_amount := NEW.price + NEW.gst_amount;

  NEW.status := 'confirmed';
  NEW.rating := null;
  NEW.review_text := null;

  if _bypass is distinct from 'on' then
    NEW.assigned_expert_id := null;
    NEW.refund_id := null;
    NEW.refund_status := null;
    NEW.refund_amount := null;
    NEW.cancellation_fee := null;
    NEW.cancellation_reason := null;
    NEW.cancelled_by := null;
    NEW.cancelled_at := null;
    NEW.started_at := null;
    NEW.service_end_at := null;
    NEW.start_otp := null;
    NEW.end_otp := null;
    NEW.broadcast_started_at := null;
    NEW.current_search_radius_km := null;
    NEW.deleted_at := null;
    NEW.deleted_by := null;
    NEW.delete_reason := null;
  end if;

  if (NEW.booking_lat is null or NEW.booking_lng is null) and NEW.address_id is not null then
    select latitude, longitude into _addr_lat, _addr_lng
      from public.addresses where id = NEW.address_id;
    if NEW.booking_lat is null then NEW.booking_lat := _addr_lat; end if;
    if NEW.booking_lng is null then NEW.booking_lng := _addr_lng; end if;
  end if;

  if NEW.booking_lat is null or NEW.booking_lng is null then
    raise exception 'Booking requires geographic coordinates: booking_lat/booking_lng were not provided and could not be resolved from address_id %', NEW.address_id
      using errcode = 'check_violation', hint = 'Ensure the selected address has latitude/longitude, or pass booking_lat/booking_lng explicitly.';
  end if;

  if _used_fallback then
    begin
      insert into public.booking_price_fallback_log(booking_id, service_label, service_category_id, matched_price_option_id)
      values (NEW.id, NEW.service_label, NEW.service_category_id, _spo.id);
    exception when others then null;
    end;
  end if;

  return NEW;
end
$fn$;

-- 5. finalize amounts so stored numbers tie out exactly with the gateway
CREATE OR REPLACE FUNCTION public.bookings_finalize_amounts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _taxable numeric; _gst_exact numeric;
BEGIN
  _taxable := GREATEST(COALESCE(NEW.price,0) - COALESCE(NEW.discount_amount,0), 0);
  _gst_exact := _taxable * COALESCE(NEW.gst_percent,0) / 100.0;
  NEW.total_amount := round(_taxable + _gst_exact);
  NEW.gst_amount := NEW.total_amount - _taxable;
  RETURN NEW;
END;
$fn$;

-- 6. payout resolution without service_catalogue_config
CREATE OR REPLACE FUNCTION public.resolve_booking_payouts(_booking_id uuid)
RETURNS TABLE(expert_payout numeric, area_partner_payout numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _b record; _ep numeric; _ap numeric;
BEGIN
  SELECT id, service_label, service_duration_minutes, service_category_id, price_option_id,
         snapshot_expert_payout, snapshot_partner_payout
    INTO _b FROM public.bookings WHERE id = _booking_id;
  IF _b.id IS NULL THEN
    RETURN QUERY SELECT 0::numeric, 0::numeric; RETURN;
  END IF;

  IF _b.price_option_id IS NOT NULL THEN
    SELECT NULLIF(COALESCE(spo.expert_payout,0),0), COALESCE(spo.partner_commission,0)
      INTO _ep, _ap
      FROM public.service_price_options spo
     WHERE spo.id = _b.price_option_id;
  END IF;

  IF _ep IS NULL THEN
    SELECT NULLIF(COALESCE(spo.expert_payout,0),0), COALESCE(spo.partner_commission,0)
      INTO _ep, _ap
      FROM public.service_price_options spo
      JOIN public.services s ON s.id = spo.service_id
     WHERE lower(spo.label) = lower(COALESCE(_b.service_label,''))
       AND (_b.service_category_id IS NULL OR s.category_id = _b.service_category_id)
       AND spo.is_active
     ORDER BY (s.category_id = _b.service_category_id) DESC, spo.display_order
     LIMIT 1;
  END IF;

  IF COALESCE(_ep,0) = 0 THEN
    _ep := NULLIF(COALESCE(_b.snapshot_expert_payout,0),0);
    _ap := COALESCE(NULLIF(COALESCE(_ap,0),0), _b.snapshot_partner_payout, 0);
  END IF;

  RETURN QUERY SELECT COALESCE(_ep,0), COALESCE(_ap,0);
END
$fn$;

-- 7. commission snapshot uses price_option_id first, no catalogue fallback
CREATE OR REPLACE FUNCTION public.bookings_snapshot_commission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _spo record; _split record; _ep numeric; _ap numeric; _hours numeric;
BEGIN
  IF NEW.assigned_area_partner_id IS NULL AND NEW.zone_id IS NOT NULL THEN
    SELECT z.assigned_area_partner_id INTO NEW.assigned_area_partner_id
      FROM public.zones z WHERE z.id = NEW.zone_id;
  END IF;

  IF NEW.price_option_id IS NOT NULL THEN
    SELECT spo.id, spo.expert_payout, spo.partner_commission INTO _spo
      FROM public.service_price_options spo
     WHERE spo.id = NEW.price_option_id;
  END IF;

  IF _spo.id IS NULL THEN
    SELECT spo.id, spo.expert_payout, spo.partner_commission
      INTO _spo
      FROM public.service_price_options spo
      JOIN public.services s ON s.id = spo.service_id
     WHERE lower(spo.label) = lower(COALESCE(NEW.service_label,''))
       AND (NEW.service_category_id IS NULL OR s.category_id = NEW.service_category_id)
       AND spo.is_active
     ORDER BY (s.category_id = NEW.service_category_id) DESC, spo.display_order
     LIMIT 1;
  END IF;

  IF public.get_ops_flag('use_new_commission_engine') THEN
    SELECT * INTO _split FROM public.resolve_commission_split(
      _spo.id, COALESCE(NEW.price,0), NEW.service_duration_minutes);
    NEW.snapshot_expert_payout  := _split.expert_amount;
    NEW.snapshot_partner_payout := _split.partner_amount;
    NEW.snapshot_hq_share       := _split.hq_amount;
    NEW.snapshot_hourly_rate    := _split.hourly_rate;
    NEW.commission_rule_id      := _split.rule_id;
  ELSE
    _ep := COALESCE(_spo.expert_payout, 0);
    _ap := COALESCE(_spo.partner_commission, 0);
    _hours := GREATEST(COALESCE(NEW.service_duration_minutes,60)::numeric / 60.0, 1.0/60.0);
    NEW.snapshot_expert_payout  := COALESCE(_ep,0);
    NEW.snapshot_partner_payout := COALESCE(_ap,0);
    NEW.snapshot_hq_share       := round(COALESCE(NEW.price,0)) - COALESCE(_ep,0) - COALESCE(_ap,0);
    NEW.snapshot_hourly_rate    := round(COALESCE(_ep,0) / _hours, 2);
    NEW.commission_rule_id      := NULL;
  END IF;

  RETURN NEW;
END
$fn$;

-- 8. extend_booking prices extensions from service_price_options
CREATE OR REPLACE FUNCTION public.extend_booking(_booking_id uuid, _extra_minutes integer, _razorpay_payment_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _owner uuid; _status text; _end timestamptz; _price numeric;
  _assigned uuid; _ext_id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _extra_minutes IS NULL OR _extra_minutes <= 0 THEN
    RAISE EXCEPTION 'Invalid extension duration';
  END IF;
  SELECT user_id, status, service_end_at, assigned_expert_id
    INTO _owner, _status, _end, _assigned
    FROM public.bookings WHERE id = _booking_id;
  IF _owner IS NULL OR _owner <> _uid THEN RAISE EXCEPTION 'Not found'; END IF;
  IF _status <> 'in_progress' OR _end IS NULL THEN
    RAISE EXCEPTION 'Service not in progress';
  END IF;
  IF now() > _end + interval '10 minutes' THEN
    RAISE EXCEPTION 'Extension window closed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.booking_extensions
     WHERE booking_id = _booking_id AND approval_status = 'pending'
  ) THEN
    RAISE EXCEPTION 'An extension request is already pending';
  END IF;

  SELECT spo.customer_price INTO _price
    FROM public.service_price_options spo
    JOIN public.services s ON s.id = spo.service_id
   WHERE COALESCE(spo.estimated_minutes, spo.duration_minutes) = _extra_minutes
     AND spo.is_active = true
     AND s.is_active = true
   ORDER BY spo.customer_price ASC
   LIMIT 1;

  IF _price IS NULL THEN RAISE EXCEPTION 'Extension duration not available'; END IF;

  INSERT INTO public.booking_extensions(booking_id, extra_minutes, price, razorpay_payment_id, approval_status)
    VALUES(_booking_id, _extra_minutes, _price, NULLIF(btrim(_razorpay_payment_id), ''), 'pending')
    RETURNING id INTO _ext_id;

  IF _assigned IS NOT NULL THEN
    PERFORM public.notify_expert_alert(
      _assigned, 'extension_request', 'Extension requested',
      'Customer requested ' || _extra_minutes::text || ' more minutes (Rs ' || _price::text || ').',
      jsonb_build_object('booking_id', _booking_id, 'extension_id', _ext_id,
        'extra_minutes', _extra_minutes, 'price', _price,
        'route', 'booking/' || _booking_id::text)
    );
  END IF;

  PERFORM public.notify_customer_alert(
    _booking_id, 'extension_pending', 'Extra time requested',
    'We sent your request for ' || _extra_minutes::text || ' more minutes to your expert. We''ll let you know as soon as they respond.',
    jsonb_build_object('extension_id', _ext_id, 'extra_minutes', _extra_minutes,
      'route', 'booking/' || _booking_id::text)
  );

  RETURN jsonb_build_object('extension_id', _ext_id, 'approval_status', 'pending',
    'extra_minutes', _extra_minutes, 'price', _price, 'service_end_at', _end);
END
$fn$;

-- 9. staff_edit_booking validates duration against service_price_options
CREATE OR REPLACE FUNCTION public.staff_edit_booking(_booking_id uuid, _payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _role text;
  _current record;
  _before jsonb := '{}'::jsonb;
  _after  jsonb := '{}'::jsonb;
  _new_duration int;
  _new_price numeric;
  _new_addr uuid;
  _new_date date;
  _new_slot text;
  _has_duration boolean;
  _has_price boolean;
  _has_addr boolean;
  _has_date boolean;
  _has_slot boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT role INTO _role FROM public.staff_users WHERE auth_user_id = _uid AND status = 'active';
  IF _role IS NULL OR _role NOT IN ('super_admin','ops_manager') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT id, status, price, service_duration_minutes, address_id,
         scheduled_date, scheduled_time_slot, deleted_at
    INTO _current
    FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF _current.id IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _current.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Booking has been deleted'; END IF;
  IF _current.status IN ('completed','cancelled','rejected') THEN
    RAISE EXCEPTION 'Booking is in a terminal state and cannot be edited';
  END IF;

  _has_duration := _payload ? 'service_duration_minutes';
  _has_price    := _payload ? 'price';
  _has_addr     := _payload ? 'address_id';
  _has_date     := _payload ? 'scheduled_date';
  _has_slot     := _payload ? 'scheduled_time_slot';

  IF _has_duration THEN
    _new_duration := NULLIF(_payload->>'service_duration_minutes','')::int;
    IF _new_duration IS NULL OR _new_duration <= 0 THEN RAISE EXCEPTION 'Invalid duration'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.service_price_options spo
       JOIN public.services s ON s.id = spo.service_id
       WHERE COALESCE(spo.estimated_minutes, spo.duration_minutes) = _new_duration
         AND spo.is_active = true AND s.is_active = true
    ) THEN
      RAISE EXCEPTION 'Duration not in active catalogue';
    END IF;
  END IF;

  IF _has_price THEN
    _new_price := NULLIF(_payload->>'price','')::numeric;
    IF _new_price IS NULL OR _new_price < 0 THEN RAISE EXCEPTION 'Invalid price'; END IF;
  END IF;

  IF _has_addr THEN
    _new_addr := NULLIF(_payload->>'address_id','')::uuid;
    IF _new_addr IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.addresses WHERE id = _new_addr
    ) THEN
      RAISE EXCEPTION 'Address not found';
    END IF;
  END IF;

  IF _has_date THEN
    _new_date := NULLIF(_payload->>'scheduled_date','')::date;
  END IF;
  IF _has_slot THEN
    _new_slot := NULLIF(btrim(_payload->>'scheduled_time_slot'),'');
  END IF;

  IF _has_duration AND _new_duration IS DISTINCT FROM _current.service_duration_minutes THEN
    _before := _before || jsonb_build_object('service_duration_minutes', _current.service_duration_minutes);
    _after  := _after  || jsonb_build_object('service_duration_minutes', _new_duration);
  END IF;
  IF _has_price AND _new_price IS DISTINCT FROM _current.price THEN
    _before := _before || jsonb_build_object('price', _current.price);
    _after  := _after  || jsonb_build_object('price', _new_price);
  END IF;
  IF _has_addr AND _new_addr IS DISTINCT FROM _current.address_id THEN
    _before := _before || jsonb_build_object('address_id', _current.address_id);
    _after  := _after  || jsonb_build_object('address_id', _new_addr);
  END IF;
  IF _has_date AND _new_date IS DISTINCT FROM _current.scheduled_date THEN
    _before := _before || jsonb_build_object('scheduled_date', _current.scheduled_date);
    _after  := _after  || jsonb_build_object('scheduled_date', _new_date);
  END IF;
  IF _has_slot AND _new_slot IS DISTINCT FROM _current.scheduled_time_slot THEN
    _before := _before || jsonb_build_object('scheduled_time_slot', _current.scheduled_time_slot);
    _after  := _after  || jsonb_build_object('scheduled_time_slot', _new_slot);
  END IF;

  IF _after = '{}'::jsonb THEN
    RETURN;
  END IF;

  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings SET
    service_duration_minutes = CASE WHEN _has_duration THEN _new_duration ELSE service_duration_minutes END,
    price                    = CASE WHEN _has_price    THEN _new_price    ELSE price END,
    address_id               = CASE WHEN _has_addr     THEN _new_addr     ELSE address_id END,
    scheduled_date           = CASE WHEN _has_date     THEN _new_date     ELSE scheduled_date END,
    scheduled_time_slot      = CASE WHEN _has_slot     THEN _new_slot     ELSE scheduled_time_slot END,
    updated_at               = now()
  WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass','off', true);

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'edit_booking', 'bookings', _booking_id, _before, _after);
END;
$fn$;

-- 10. deprecate the legacy catalogue table and lock its staff editors
COMMENT ON TABLE public.service_catalogue_config IS
  'DEPRECATED (2026-09-30). Superseded by public.service_price_options. Not used for booking price, duration, payouts, extensions or staff edits. Kept for history only.';

REVOKE EXECUTE ON FUNCTION public.staff_update_service_price(uuid, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.staff_create_service_catalogue_row(jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.staff_delete_service_catalogue_row(uuid) FROM anon, authenticated;
