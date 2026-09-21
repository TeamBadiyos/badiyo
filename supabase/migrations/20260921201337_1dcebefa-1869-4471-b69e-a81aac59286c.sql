
-- Read functions sirf authenticated (app login ke baad hi chalti hai)
revoke execute on function public.service_effective_state(text, text, timestamptz) from anon, public;
revoke execute on function public.service_can_order(text, timestamptz) from anon, public;
revoke execute on function public.service_window(text, text) from anon, public;
revoke execute on function public.slot_start_ist(date, text) from anon, public;

-- service_hours/service_holidays ka anon SELECT bhi band (config sirf logged-in app ko)
revoke select on public.service_hours from anon;
revoke select on public.service_holidays from anon;
drop policy if exists "service_hours public read" on public.service_hours;
drop policy if exists "service_holidays public read" on public.service_holidays;
create policy "service_hours authenticated read" on public.service_hours for select to authenticated using (true);
create policy "service_holidays authenticated read" on public.service_holidays for select to authenticated using (true);

-- Deny-by-default tables par explicit policies (linter + clarity)
create policy "users read own bypass row" on public.service_hours_bypass_users
  for select to authenticated using (auth.uid() = user_id);
grant select on public.service_hours_bypass_users to authenticated;

create policy "no client access to focus snapshots" on public.service_focus_snapshots
  for select to authenticated using (false);
grant select on public.service_focus_snapshots to authenticated;
