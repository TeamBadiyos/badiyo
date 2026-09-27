DROP POLICY "Owner and ops read removed packets" ON public.business_trip_removed_packets;
CREATE POLICY "Owner and ops read removed packets" ON public.business_trip_removed_packets
FOR SELECT TO authenticated USING (public.courier_is_ops_staff() OR merchant_id = public.current_merchant_id());
DO $m$ declare d text; begin
  select pg_get_functiondef('public.business_left_behind_stats(uuid,date)'::regprocedure) into d;
  d := replace(d, $x$public.is_active_staff(auth.uid(), ARRAY['super_admin'::text, 'ops_manager'::text, 'ops'::text])$x$, 'public.courier_is_ops_staff()');
  d := replace(d, $x$public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager','ops'])$x$, 'public.courier_is_ops_staff()');
  if position('courier_is_ops_staff' in d)=0 then raise exception 'patch failed'; end if;
  execute d; end $m$;