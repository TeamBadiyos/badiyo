CREATE OR REPLACE FUNCTION public.my_referral_history()
RETURNS TABLE (
  id uuid,
  status text,
  reward_amount numeric,
  signup_reward_amount numeric,
  booking_reward_amount numeric,
  created_at timestamptz,
  referred_user_id uuid,
  referred_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT rt.id,
         rt.status,
         rt.reward_amount,
         rt.signup_reward_amount,
         rt.booking_reward_amount,
         rt.created_at,
         rt.referred_user_id,
         nullif(btrim(coalesce(u.full_name, '')), '') AS referred_name
  FROM public.referral_transactions rt
  LEFT JOIN public.users u ON u.id = rt.referred_user_id
  WHERE auth.uid() IS NOT NULL
    AND rt.referrer_id = auth.uid()
  ORDER BY rt.created_at DESC
$$;

REVOKE ALL ON FUNCTION public.my_referral_history() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_referral_history() TO authenticated, service_role;