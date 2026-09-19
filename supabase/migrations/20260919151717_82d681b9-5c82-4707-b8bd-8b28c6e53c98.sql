
-- Counters
ALTER TABLE public.courier_order_secrets
  ADD COLUMN IF NOT EXISTS pickup_send_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_send_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pickup_last_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_last_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS pickup_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_verified_at timestamptz;

ALTER TABLE public.courier_orders
  ADD COLUMN IF NOT EXISTS pickup_contact_edit_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS drop_contact_edit_count integer NOT NULL DEFAULT 0;

INSERT INTO public.ops_settings (key, value, label)
VALUES ('courier_otp_resend_cooldown_seconds','60','Courier OTP resend cooldown (seconds)'),
       ('courier_otp_max_sends','3','Courier OTP max sends per purpose'),
       ('courier_contact_edit_cap','2','Courier contact number edit cap')
ON CONFLICT (key) DO NOTHING;

-- Shared gate: owner + stage check, returns order row
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
  if _purpose = 'pickup' and _o.status <> 'ARRIVED_PICKUP' then
    raise exception 'Pickup OTP is available once the rider reaches the pickup point';
  end if;
  if _purpose = 'delivery' and _o.status <> 'IN_TRANSIT' then
    raise exception 'Delivery OTP is available once the parcel is in transit';
  end if;
  return _o;
end $$;

-- Prepare a resend: validates cooldown + cap, bumps counters, returns otp + target phone
CREATE OR REPLACE FUNCTION public.courier_resend_otp(_order_id uuid, _purpose text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare
  _o public.courier_orders%rowtype;
  _s public.courier_order_secrets%rowtype;
  _cooldown int := public.courier_setting('courier_otp_resend_cooldown_seconds', 60)::int;
  _max int := public.courier_setting('courier_otp_max_sends', 3)::int;
  _last timestamptz; _count int; _otp text; _phone text;
begin
  _o := public.courier_otp_owner_gate(_order_id, _purpose);
  select * into _s from public.courier_order_secrets where order_id = _order_id;

  if _purpose = 'pickup' then
    _last := _s.pickup_last_sent_at; _count := coalesce(_s.pickup_send_count,0);
    _phone := _o.pickup_contact_phone;
    if _s.pickup_verified_at is not null then raise exception 'Pickup OTP is already verified'; end if;
  else
    _last := _s.delivery_last_sent_at; _count := coalesce(_s.delivery_send_count,0);
    _phone := _o.drop_contact_phone;
    if _s.delivery_verified_at is not null then raise exception 'Delivery OTP is already verified'; end if;
  end if;

  if _last is not null and now() < _last + make_interval(secs => _cooldown) then
    raise exception 'Please wait % seconds before sending again',
      ceil(extract(epoch from (_last + make_interval(secs => _cooldown)) - now()));
  end if;
  if _count >= _max then raise exception 'Resend limit reached for this OTP'; end if;

  -- Re-issue if never issued or already expired, else reuse the live code
  if _purpose = 'pickup' then
    if _s.pickup_otp_issued_at is null or _s.pickup_otp_expires_at <= now() then
      _otp := public.courier_issue_otp(_order_id, 'pickup');
      select * into _s from public.courier_order_secrets where order_id = _order_id;
    else
      _otp := public.courier_derive_otp(_order_id, 'pickup', _s.pickup_otp_issued_at);
    end if;
    update public.courier_order_secrets
       set pickup_send_count = coalesce(pickup_send_count,0) + 1,
           pickup_last_sent_at = now(), updated_at = now()
     where order_id = _order_id;
  else
    if _s.delivery_otp_issued_at is null or _s.delivery_otp_expires_at <= now() then
      _otp := public.courier_issue_otp(_order_id, 'delivery');
      select * into _s from public.courier_order_secrets where order_id = _order_id;
    else
      _otp := public.courier_derive_otp(_order_id, 'delivery', _s.delivery_otp_issued_at);
    end if;
    update public.courier_order_secrets
       set delivery_send_count = coalesce(delivery_send_count,0) + 1,
           delivery_last_sent_at = now(), updated_at = now()
     where order_id = _order_id;
  end if;

  insert into public.courier_order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
  values (_order_id, _o.status, _o.status, 'customer', auth.uid(),
          jsonb_build_object('event','otp_send_requested','purpose',_purpose,
                             'sends', _count + 1, 'phone_last4', right(coalesce(_phone,''),4)));

  return jsonb_build_object('otp', _otp, 'phone', _phone, 'purpose', _purpose,
                            'sends_used', _count + 1, 'max_sends', _max);
end $$;

-- Record the outcome of a WhatsApp send attempt
CREATE OR REPLACE FUNCTION public.courier_log_otp_send(_order_id uuid, _purpose text, _ok boolean, _detail text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare _o public.courier_orders%rowtype;
begin
  select * into _o from public.courier_orders where id = _order_id;
  if _o.id is null then return; end if;
  insert into public.courier_order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
  values (_order_id, _o.status, _o.status, 'system', null,
          jsonb_build_object('event', case when _ok then 'otp_sent' else 'otp_send_failed' end,
                             'purpose', _purpose, 'detail', left(coalesce(_detail,''), 500)));
end $$;

-- Issue a brand new code (old one becomes invalid immediately)
CREATE OR REPLACE FUNCTION public.courier_refresh_otp(_order_id uuid, _purpose text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare _o public.courier_orders%rowtype; _s public.courier_order_secrets%rowtype; _otp text;
begin
  _o := public.courier_otp_owner_gate(_order_id, _purpose);
  select * into _s from public.courier_order_secrets where order_id = _order_id;
  if _purpose = 'pickup' and _s.pickup_verified_at is not null then
    raise exception 'Pickup OTP is already verified';
  end if;
  if _purpose = 'delivery' and _s.delivery_verified_at is not null then
    raise exception 'Delivery OTP is already verified';
  end if;

  _otp := public.courier_issue_otp(_order_id, _purpose);

  insert into public.courier_order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
  values (_order_id, _o.status, _o.status, 'customer', auth.uid(),
          jsonb_build_object('event','otp_refreshed','purpose',_purpose));

  return jsonb_build_object('otp', _otp, 'purpose', _purpose);
end $$;

-- Change pickup/drop contact number while that OTP is still unverified
CREATE OR REPLACE FUNCTION public.courier_update_contact(_order_id uuid, _purpose text, _new_phone text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare
  _o public.courier_orders%rowtype;
  _s public.courier_order_secrets%rowtype;
  _cap int := public.courier_setting('courier_contact_edit_cap', 2)::int;
  _digits text; _old text; _edits int; _otp text;
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode='42501'; end if;
  if _purpose not in ('pickup','delivery') then raise exception 'Invalid contact type'; end if;
  select * into _o from public.courier_orders where id = _order_id;
  if _o.id is null or _o.customer_id <> auth.uid() then raise exception 'Forbidden' using errcode='42501'; end if;
  if _o.status in ('DELIVERED','COMPLETED','CANCELLED','FAILED_DELIVERY') then
    raise exception 'This order is closed';
  end if;

  _digits := regexp_replace(coalesce(_new_phone,''), '[^0-9]', '', 'g');
  if length(_digits) = 12 and left(_digits,2) = '91' then _digits := right(_digits,10); end if;
  if _digits !~ '^[6-9][0-9]{9}$' then raise exception 'Enter a valid 10-digit mobile number'; end if;

  select * into _s from public.courier_order_secrets where order_id = _order_id;

  if _purpose = 'pickup' then
    if _s.pickup_verified_at is not null then raise exception 'Pickup is already verified'; end if;
    _old := _o.pickup_contact_phone; _edits := coalesce(_o.pickup_contact_edit_count,0);
  else
    if _s.delivery_verified_at is not null then raise exception 'Delivery is already verified'; end if;
    _old := _o.drop_contact_phone; _edits := coalesce(_o.drop_contact_edit_count,0);
  end if;

  if _edits >= _cap then raise exception 'Contact number can no longer be changed for this order'; end if;
  if regexp_replace(coalesce(_old,''), '[^0-9]', '', 'g') = _digits then
    return jsonb_build_object('changed', false, 'phone', _old);
  end if;

  if _purpose = 'pickup' then
    update public.courier_orders
       set pickup_contact_phone = _digits,
           pickup_contact_edit_count = _edits + 1,
           updated_at = now()
     where id = _order_id;
    update public.courier_order_secrets
       set pickup_send_count = 0, pickup_last_sent_at = null, updated_at = now()
     where order_id = _order_id;
  else
    update public.courier_orders
       set drop_contact_phone = _digits,
           drop_contact_edit_count = _edits + 1,
           updated_at = now()
     where id = _order_id;
    update public.courier_order_secrets
       set delivery_send_count = 0, delivery_last_sent_at = null, updated_at = now()
     where order_id = _order_id;
  end if;

  -- Old code dies with the old number
  _otp := public.courier_issue_otp(_order_id, _purpose);

  insert into public.courier_order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
  values (_order_id, _o.status, _o.status, 'customer', auth.uid(),
          jsonb_build_object('event','contact_updated','purpose',_purpose,
                             'old_last4', right(coalesce(_old,''),4), 'new_last4', right(_digits,4),
                             'edits', _edits + 1));

  insert into public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(), 'courier_contact_updated', 'courier_orders', _order_id,
          jsonb_build_object('purpose',_purpose,'phone_last4', right(coalesce(_old,''),4)),
          jsonb_build_object('purpose',_purpose,'phone_last4', right(_digits,4),'edits', _edits + 1));

  return jsonb_build_object('changed', true, 'phone', _digits, 'edits_used', _edits + 1, 'edit_cap', _cap);
end $$;

REVOKE ALL ON FUNCTION public.courier_otp_owner_gate(uuid, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.courier_log_otp_send(uuid, text, boolean, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.courier_resend_otp(uuid, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.courier_refresh_otp(uuid, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.courier_update_contact(uuid, text, text) FROM public, anon;

GRANT EXECUTE ON FUNCTION public.courier_otp_owner_gate(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.courier_log_otp_send(uuid, text, boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.courier_resend_otp(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.courier_refresh_otp(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.courier_update_contact(uuid, text, text) TO authenticated, service_role;
