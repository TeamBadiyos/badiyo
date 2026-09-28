create or replace function public.courier_my_contact_deliveries() returns jsonb language plpgsql stable security definer set search_path TO 'public' as $function$
declare _me text := public.courier_my_phone10();
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode='42501'; end if;
  if _me is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('order_id',o.id,'order_code',o.order_code,'stop_id',s.id,
      'role',case s.stop_type when 'pickup' then 'pickup' when 'drop' then 'drop' else 'return' end,
      'address',s.address,'stop_status',s.status,'order_status',o.status,
      'created_at',o.created_at,
      'sender_label',case when s.stop_type='pickup' then split_part(coalesce(u.full_name,''),' ',1)
        else (select p.contact_name from public.courier_order_stops p where p.order_id=o.id and p.stop_type='pickup' order by p.sequence limit 1) end
    ) order by o.created_at desc, s.sequence)
    from public.courier_order_stops s join public.courier_orders o on o.id=s.order_id
    left join public.users u on u.id=o.customer_id
    where right(regexp_replace(coalesce(s.contact_phone,''),'\D','','g'),10)=_me
      and o.customer_id<>auth.uid()
      and (o.status not in ('DELIVERED','COMPLETED','CANCELLED','FAILED_DELIVERY','EXPIRED')
           or coalesce(o.completed_at,o.delivered_at,o.cancelled_at,o.updated_at) > now()-interval '24 hours')),'[]'::jsonb);
end $function$;