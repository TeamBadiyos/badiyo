REVOKE ALL ON FUNCTION public.credit_referral_signup(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_referral_signup(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.staff_update_referral_rewards(numeric, numeric, boolean, integer, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_update_referral_rewards(numeric, numeric, boolean, integer, numeric) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.staff_get_referral_config() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_get_referral_config() TO authenticated, service_role;