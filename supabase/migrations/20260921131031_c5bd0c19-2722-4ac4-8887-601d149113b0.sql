create or replace function public.courier_get_rider_info(_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare _o public.courier_orders%rowtype; _e record;
begin
  if auth.uid() is null then raise exception 'Not authorized' using errcode='42501'; end if;

  select * into _o from public.courier_orders where id = _order_id;
  if _o.id is null or _o.customer_id <> auth.uid() then
    raise exception 'Forbidden' using errcode='42501';
  end if;

  if _o.assigned_expert_id is null then
    return jsonb_build_object('available', false);
  end if;

  select name, phone, photo_url into _e
    from public.experts where id = _o.assigned_expert_id;

  return jsonb_build_object(
    'available', true,
    'name', _e.name,
    'phone', _e.phone,
    'photo_url', _e.photo_url
  );
end $$;

revoke all on function public.courier_get_rider_info(uuid) from public, anon;
grant execute on function public.courier_get_rider_info(uuid) to authenticated, service_role;