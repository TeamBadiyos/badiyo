-- Keep the delivery code the customer already shared during PICKED_UP when the
-- rider advances to IN_TRANSIT (courier_rider_advance calls courier_issue_otp
-- right after setting in_transit_at = now() in the same transaction).
-- Rollback: re-run courier_issue_otp from migration 20260919153021.
CREATE OR REPLACE FUNCTION public.courier_issue_otp(_order_id uuid, _purpose text)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _issued timestamptz := clock_timestamp(); _otp text; _prev timestamptz; _exp timestamptz; _transit timestamptz;
begin
  insert into public.courier_order_secrets (order_id) values (_order_id) on conflict do nothing;

  if _purpose = 'pickup' then
    select pickup_otp_issued_at into _prev from public.courier_order_secrets where order_id = _order_id;
  else
    select delivery_otp_issued_at, delivery_otp_expires_at into _prev, _exp
      from public.courier_order_secrets where order_id = _order_id;
    select in_transit_at into _transit from public.courier_orders where id = _order_id;
    if _prev is not null and _exp > clock_timestamp() and _transit = now() then
      return public.courier_derive_otp(_order_id, _purpose, _prev);
    end if;
  end if;
  if _prev is not null and _issued <= _prev then
    _issued := _prev + interval '1 microsecond';
  end if;

  _otp := public.courier_derive_otp(_order_id, _purpose, _issued);

  if _purpose = 'pickup' then
    update public.courier_order_secrets
       set pickup_otp_hash = public.courier_hash_otp(_otp), pickup_otp_issued_at = _issued,
           pickup_otp_expires_at = clock_timestamp() + interval '12 hours', pickup_attempts = 0, updated_at = now()
     where order_id = _order_id;
  else
    update public.courier_order_secrets
       set delivery_otp_hash = public.courier_hash_otp(_otp), delivery_otp_issued_at = _issued,
           delivery_otp_expires_at = clock_timestamp() + interval '12 hours', delivery_attempts = 0, updated_at = now()
     where order_id = _order_id;
  end if;
  return _otp;
end $function$;

REVOKE ALL ON FUNCTION public.courier_issue_otp(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.courier_issue_otp(uuid, text) TO service_role;