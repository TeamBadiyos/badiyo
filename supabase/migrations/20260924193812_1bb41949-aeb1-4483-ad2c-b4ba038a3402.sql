create or replace function public.courier_notify_stop_contact(_stop_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare _st public.courier_order_stops%rowtype; _owner uuid; _p text; _uid uuid; _lang text;
begin
  select * into _st from public.courier_order_stops where id=_stop_id;
  if _st.id is null then return; end if;
  _p := right(regexp_replace(coalesce(_st.contact_phone,''),'\D','','g'),10);
  if length(_p)<10 then return; end if;
  select customer_id into _owner from public.courier_orders where id=_st.order_id;
  for _uid in
    select u.id from public.users u left join auth.users a on a.id=u.id
     where u.deleted_at is null and u.id<>_owner
       and right(regexp_replace(coalesce(nullif(a.phone,''),u.phone,''),'\D','','g'),10)=_p
     limit 3
  loop
    select coalesce(u.preferred_language, 'en') into _lang from public.users u where u.id=_uid;
    if _lang = 'mr' then
      perform public.notify_customer_user_push(_uid,'पार्सल अपडेट','तुमचा OTP पाहण्यासाठी Badiyos उघडा','parcels-for-you');
    else
      perform public.notify_customer_user_push(_uid,'Parcel update','Open Badiyos to see your OTP','parcels-for-you');
    end if;
  end loop;
exception when others then null;
end $$;
revoke all on function public.courier_notify_stop_contact(uuid) from public, anon, authenticated;
grant execute on function public.courier_notify_stop_contact(uuid) to service_role;