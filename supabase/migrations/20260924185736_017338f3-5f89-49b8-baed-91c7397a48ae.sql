DO $$
declare _f text; _def text; _new text;
begin
  foreach _f in array array['courier_mark_charge_paid','staff_courier_waive_charge','courier_recompute_order_progress','courier_sweeper_tick'] loop
    select pg_get_functiondef(p.oid) into _def from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname=_f;
    _new := regexp_replace(_def,
      'values \((\w+(?:\.\w+)?), null, null,',
      'values (\1, (select status from public.courier_orders where id=\1), (select status from public.courier_orders where id=\1),',
      'g');
    if _new = _def then raise exception 'No change made in %', _f; end if;
    execute _new;
  end loop;
end $$;