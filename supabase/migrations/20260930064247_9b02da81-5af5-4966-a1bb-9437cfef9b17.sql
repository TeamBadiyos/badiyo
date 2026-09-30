-- 1d. credit_referral_for_booking: already covered by trigger trg_bookings_after_complete_referral
REVOKE EXECUTE ON FUNCTION public.credit_referral_for_booking(uuid) FROM anon, authenticated, PUBLIC;

-- 2. internal reward/payout/tax calculators (all callers are SECURITY DEFINER)
REVOKE EXECUTE ON FUNCTION public.run_reward_period_jobs(date) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.compute_tds(text, uuid, numeric) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_booking_payouts(uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_commission_split(uuid, numeric, integer) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reward_gates_pass(jsonb, uuid, timestamptz, timestamptz) FROM anon, authenticated, PUBLIC;

-- 3. anon-only revoke, keep authenticated
REVOKE EXECUTE ON FUNCTION public.offers_caller_role(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.offers_caller_city(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.offers_caller_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.offers_caller_city(uuid) TO authenticated;

-- 5.
COMMENT ON TABLE public.ops_settings IS 'No secrets here. Readable via get_ops_* helpers.';