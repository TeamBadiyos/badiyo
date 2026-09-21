
grant execute on function public.slot_start_ist(date, text) to public;
grant execute on function public.service_effective_state(text, text, timestamptz) to service_role;
grant execute on function public.service_slot_allowed(text, date, text, int) to service_role;
