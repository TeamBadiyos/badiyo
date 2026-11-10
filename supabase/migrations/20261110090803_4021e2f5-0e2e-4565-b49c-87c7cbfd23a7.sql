CREATE OR REPLACE FUNCTION public.bookings_fill_missing_otps()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.start_otp IS NULL OR btrim(NEW.start_otp) = '' THEN NEW.start_otp := public.generate_otp4(); END IF;
  IF NEW.end_otp IS NULL OR btrim(NEW.end_otp) = '' THEN NEW.end_otp := public.generate_otp4(); END IF;
  RETURN NEW;
END $$;

DO $$ BEGIN
  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings SET start_otp = coalesce(nullif(btrim(start_otp),''), public.generate_otp4()),
                             end_otp = coalesce(nullif(btrim(end_otp),''), public.generate_otp4())
   WHERE deleted_at IS NULL
     AND status NOT IN ('completed','cancelled','rejected','expired','failed')
     AND (start_otp IS NULL OR btrim(start_otp)='' OR end_otp IS NULL OR btrim(end_otp)='');
  PERFORM set_config('app.booking_bypass','off', true);
END $$;

CREATE OR REPLACE FUNCTION public.get_my_booking_otps(_booking_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b record; _st text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT user_id, status, assigned_expert_id, start_otp, end_otp INTO b
    FROM public.bookings WHERE id = _booking_id AND deleted_at IS NULL;
  IF NOT FOUND OR b.user_id <> auth.uid() THEN RAISE EXCEPTION 'Not found'; END IF;
  IF b.start_otp IS NULL OR btrim(b.start_otp)='' OR b.end_otp IS NULL OR btrim(b.end_otp)='' THEN
    b.start_otp := coalesce(nullif(btrim(b.start_otp),''), public.generate_otp4());
    b.end_otp := coalesce(nullif(btrim(b.end_otp),''), public.generate_otp4());
    PERFORM set_config('app.booking_bypass','on', true);
    UPDATE public.bookings SET start_otp = b.start_otp, end_otp = b.end_otp WHERE id = _booking_id;
    PERFORM set_config('app.booking_bypass','off', true);
  END IF;
  -- An assigned expert while status still says accepted/confirmed counts as assigned.
  _st := CASE WHEN b.status IN ('accepted','confirmed') AND b.assigned_expert_id IS NOT NULL THEN 'expert_assigned' ELSE b.status END;
  RETURN jsonb_build_object(
    'status', _st,
    'start_otp', CASE WHEN _st IN ('expert_assigned','on_the_way','arrived') THEN b.start_otp END,
    'end_otp', CASE WHEN _st = 'in_progress' THEN b.end_otp END
  );
END $$;
REVOKE ALL ON FUNCTION public.get_my_booking_otps(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_booking_otps(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.courier_get_otp(_order_id uuid, _purpose text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
declare _o public.courier_orders%rowtype; _sid uuid; _s public.courier_stop_secrets%rowtype; _st public.courier_order_stops%rowtype;
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode='42501'; end if;
  select * into _o from public.courier_orders where id = _order_id;
  if _o.id is null or _o.customer_id <> auth.uid() then raise exception 'Forbidden' using errcode='42501'; end if;
  if _purpose not in ('pickup','delivery') then raise exception 'Invalid OTP type'; end if;
  if _purpose = 'pickup' and _o.status not in ('DRIVER_ASSIGNED','ARRIVED_PICKUP') then
    raise exception 'Pickup OTP is available once a rider is assigned'; end if;
  if _purpose = 'delivery' and _o.status not in ('PICKED_UP','IN_TRANSIT') then
    raise exception 'Delivery OTP is available once the parcel is in transit'; end if;
  _sid := public.courier_resolve_stop(_order_id, _purpose);
  if _sid is null then return jsonb_build_object('otp', null); end if;
  select * into _st from public.courier_order_stops where id=_sid;
  select * into _s from public.courier_stop_secrets where stop_id = _sid;
  if _s.verified_at is not null or _st.status = 'completed' then return jsonb_build_object('otp', null); end if;
  if _s.otp_issued_at is null or (_s.otp_expires_at is not null and _s.otp_expires_at <= now()) then
    return jsonb_build_object('otp', public.courier_issue_stop_otp(_sid));
  end if;
  return jsonb_build_object('otp', public.courier_derive_otp(_sid, _purpose, _s.otp_issued_at));
end $f$;
REVOKE EXECUTE ON FUNCTION public.courier_get_otp(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.courier_get_otp(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.courier_otp_owner_gate(_order_id uuid, _purpose text)
RETURNS public.courier_orders
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
declare _o public.courier_orders%rowtype;
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode='42501'; end if;
  if _purpose not in ('pickup','delivery') then raise exception 'Invalid OTP type'; end if;
  select * into _o from public.courier_orders where id = _order_id;
  if _o.id is null or _o.customer_id <> auth.uid() then raise exception 'Forbidden' using errcode='42501'; end if;
  if _purpose = 'pickup' and _o.status not in ('DRIVER_ASSIGNED','ARRIVED_PICKUP') then
    raise exception 'Pickup OTP is available once a rider is assigned'; end if;
  if _purpose = 'delivery' and _o.status not in ('PICKED_UP','IN_TRANSIT') then
    raise exception 'Delivery OTP is available once the parcel is in transit'; end if;
  return _o;
end $$;
REVOKE ALL ON FUNCTION public.courier_otp_owner_gate(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.courier_otp_owner_gate(uuid, text) TO service_role;