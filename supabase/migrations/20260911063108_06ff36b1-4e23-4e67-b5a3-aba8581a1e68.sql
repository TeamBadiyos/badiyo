CREATE OR REPLACE FUNCTION public.apply_referral_code(_code text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _referrer_id uuid;
  _current_ref text;
BEGIN
  IF _uid IS NULL THEN RETURN 'not_authenticated'; END IF;
  IF _code IS NULL OR length(trim(_code)) = 0 THEN RETURN 'invalid_code'; END IF;

  SELECT referred_by INTO _current_ref FROM public.users WHERE id = _uid;
  IF _current_ref IS NOT NULL AND length(_current_ref) > 0 THEN RETURN 'already_referred'; END IF;

  SELECT id INTO _referrer_id FROM public.users
   WHERE upper(referral_code) = upper(trim(_code)) LIMIT 1;
  IF _referrer_id IS NULL THEN RETURN 'invalid_code'; END IF;
  IF _referrer_id = _uid THEN RETURN 'self_referral'; END IF;

  PERFORM set_config('app.users_bypass', 'on', true);
  UPDATE public.users SET referred_by = upper(trim(_code)) WHERE id = _uid;
  PERFORM set_config('app.users_bypass', 'off', true);

  IF NOT EXISTS (SELECT 1 FROM public.referral_transactions WHERE referred_user_id = _uid) THEN
    INSERT INTO public.referral_transactions (referrer_id, referred_user_id, status)
    VALUES (_referrer_id, _uid, 'pending');
  END IF;

  PERFORM public.evaluate_reward_triggers('customer', _referrer_id, 'referral_signup', _uid::text,
    jsonb_build_object('referred_user_id', _uid));

  RETURN 'applied';
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_referral_code(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.apply_referral_code(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.link_referral(_code text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.apply_referral_code(_code);
END;
$function$;