GRANT SELECT ON public.reward_programs TO authenticated;
GRANT SELECT ON public.reward_trigger_types TO authenticated;
GRANT SELECT ON public.reward_ledger TO authenticated;

CREATE POLICY "reward_programs_customer_read" ON public.reward_programs
FOR SELECT TO authenticated
USING (actor_type = 'customer');

CREATE POLICY "reward_trigger_types_read" ON public.reward_trigger_types
FOR SELECT TO authenticated
USING (true);