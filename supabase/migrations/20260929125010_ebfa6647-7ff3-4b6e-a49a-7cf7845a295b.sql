revoke execute on function public.service_slot_allowed(text, date, text, int) from anon;
grant execute on function public.service_slot_allowed(text, date, text, int) to authenticated, service_role;