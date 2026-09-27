do $$
declare _def text; _new text;
begin
  select pg_get_functiondef(p.oid) into _def from pg_proc p where p.proname='business_get_trip_otps' and p.pronamespace='public'::regnamespace;
  _new := replace(_def,
    '_fee := greatest(0, round(_amt * public.courier_setting(''courier_cancel_fee_pct'', 50) / 100, 2));',
    '_fee := (select f.fee_total from public.courier_cancel_fee_for(_o.id) f);');
  if _new = _def then raise exception 'pattern not found'; end if;
  execute _new;
end $$;