-- Allow the delivery OTP from PICKED_UP through IN_TRANSIT (the whole
-- "On the way" stage). Rollback: restore the original checks below to
-- `_o.status = 'IN_TRANSIT'` / `_o.status not in ('IN_TRANSIT')`.

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
  if _purpose = 'delivery' and _o.status not in ('PICKED_UP','IN_TRANSIT') then
    raise exception 'Delivery OTP is available once the parcel is in transit';
  end if;
  return _o;
end $$;

create or replace function public.courier_get_otp(_order_id uuid, _purpose text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _o public.courier_orders%rowtype; _s public.courier_order_secrets%rowtype;
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode='42501'; end if;
  select * into _o from public.courier_orders where id = _order_id;
  if _o.id is null or _o.customer_id <> auth.uid() then raise exception 'Forbidden' using errcode='42501'; end if;
  if _purpose not in ('pickup','delivery') then raise exception 'Invalid OTP type'; end if;
  if _purpose = 'pickup' and _o.status not in ('ARRIVED_PICKUP') then
    raise exception 'Pickup OTP is available once the rider reaches the pickup point';
  end if;
  if _purpose = 'delivery' and _o.status not in ('PICKED_UP','IN_TRANSIT') then
    raise exception 'Delivery OTP is available once the parcel is in transit';
  end if;

  select * into _s from public.courier_order_secrets where order_id = _order_id;
  if _purpose = 'pickup' then
    if _s.pickup_otp_issued_at is null then raise exception 'OTP not generated yet'; end if;
    return jsonb_build_object('otp', public.courier_derive_otp(_order_id,'pickup',_s.pickup_otp_issued_at));
  else
    if _s.delivery_otp_issued_at is null then raise exception 'OTP not generated yet'; end if;
    return jsonb_build_object('otp', public.courier_derive_otp(_order_id,'delivery',_s.delivery_otp_issued_at));
  end if;
end $$;

-- Restore existing permissions exactly as before
REVOKE ALL ON FUNCTION public.courier_otp_owner_gate(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.courier_otp_owner_gate(uuid, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.courier_get_otp(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.courier_get_otp(uuid, text) TO authenticated, service_role;
