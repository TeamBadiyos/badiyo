CREATE OR REPLACE FUNCTION public.reactivate_customer_after_otp(_user_id uuid, _phone text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF _user_id IS NULL OR _phone IS NULL OR _phone = '' THEN
    RAISE EXCEPTION 'Invalid account recovery request';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _user_id) THEN
    RAISE EXCEPTION 'Authentication user not found';
  END IF;

  PERFORM set_config('app.users_bypass', 'on', true);

  INSERT INTO public.users (id, phone, deleted_at, updated_at)
  VALUES (_user_id, _phone, NULL, now())
  ON CONFLICT (id) DO UPDATE
    SET phone = EXCLUDED.phone,
        deleted_at = NULL,
        referral_code = COALESCE(public.users.referral_code, upper(substring(md5(public.users.id::text) from 1 for 6))),
        updated_at = now();

  PERFORM set_config('app.users_bypass', 'off', true);
END;
$function$;