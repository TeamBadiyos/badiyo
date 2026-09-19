CREATE OR REPLACE FUNCTION public.courier_derive_otp(_order_id uuid, _purpose text, _issued_at timestamp with time zone)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  select lpad((
    ('x' || substr(encode(extensions.hmac(
        _order_id::text || ':' || _purpose || ':' || (extract(epoch from _issued_at) * 1000000)::bigint::text,
        public.courier_otp_key(), 'sha256'), 'hex'), 1, 8))::bit(32)::bigint % 10000
  )::text, 4, '0')
$function$;

CREATE OR REPLACE FUNCTION public.courier_issue_otp(_order_id uuid, _purpose text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _issued timestamptz := clock_timestamp(); _otp text; _prev timestamptz;
begin
  insert into public.courier_order_secrets (order_id) values (_order_id) on conflict do nothing;

  -- Guarantee a distinct issued_at so the new code can never equal the previous one
  if _purpose = 'pickup' then
    select pickup_otp_issued_at into _prev from public.courier_order_secrets where order_id = _order_id;
  else
    select delivery_otp_issued_at into _prev from public.courier_order_secrets where order_id = _order_id;
  end if;
  if _prev is not null and _issued <= _prev then
    _issued := _prev + interval '1 microsecond';
  end if;

  _otp := public.courier_derive_otp(_order_id, _purpose, _issued);

  if _purpose = 'pickup' then
    update public.courier_order_secrets
       set pickup_otp_hash = public.courier_hash_otp(_otp),
           pickup_otp_issued_at = _issued,
           pickup_otp_expires_at = clock_timestamp() + interval '12 hours',
           pickup_attempts = 0,
           updated_at = now()
     where order_id = _order_id;
  else
    update public.courier_order_secrets
       set delivery_otp_hash = public.courier_hash_otp(_otp),
           delivery_otp_issued_at = _issued,
           delivery_otp_expires_at = clock_timestamp() + interval '12 hours',
           delivery_attempts = 0,
           updated_at = now()
     where order_id = _order_id;
  end if;
  return _otp;
end $function$;

REVOKE ALL ON FUNCTION public.courier_derive_otp(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.courier_issue_otp(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.courier_derive_otp(uuid, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.courier_issue_otp(uuid, text) TO service_role;