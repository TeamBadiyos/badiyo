revoke execute on function public.staff_reassign_store_rider(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.staff_cancel_store_order_apply(uuid, text, text, text, numeric) from public, anon, authenticated;
revoke execute on function public.staff_commerce_admin_id() from public, anon, authenticated;
grant execute on function public.staff_reassign_store_rider(uuid, uuid) to service_role;
grant execute on function public.staff_cancel_store_order_apply(uuid, text, text, text, numeric) to service_role;
grant execute on function public.staff_commerce_admin_id() to service_role;