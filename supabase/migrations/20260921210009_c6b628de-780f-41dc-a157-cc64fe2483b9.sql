create or replace function public.staff_set_last_order_buffer(_service_key text, _minutes int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare _old record;
begin
  perform public.staff_require_super_admin();

  if _minutes is null or _minutes < 0 or _minutes > 240 then
    raise exception 'Invalid buffer minutes: must be between 0 and 240';
  end if;

  select * into _old from public.service_flags where service_key = _service_key order by created_at limit 1;
  if not found then raise exception 'Unknown service %', _service_key; end if;

  update public.service_flags
     set last_order_buffer_minutes = _minutes,
         status_updated_at = now(),
         status_updated_by = auth.uid()
   where id = _old.id;

  insert into public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(), 'service_buffer_change', 'service_flags', _old.id,
    jsonb_build_object('last_order_buffer_minutes', _old.last_order_buffer_minutes),
    jsonb_build_object('last_order_buffer_minutes', _minutes));

  return jsonb_build_object('ok', true, 'service_key', _service_key, 'last_order_buffer_minutes', _minutes);
end $$;

revoke execute on function public.staff_set_last_order_buffer(text, int) from public, anon, authenticated;

update public.service_flags set last_order_buffer_minutes = 30 where service_key = 'courier';