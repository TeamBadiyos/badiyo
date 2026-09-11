CREATE OR REPLACE FUNCTION public.get_auth_user_id_by_email(_email text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT matched.id
  FROM (
    SELECT u.id, 0 AS priority
      FROM auth.users u
     WHERE lower(u.email) = lower(_email)
    UNION ALL
    SELECT i.user_id AS id, 1 AS priority
      FROM auth.identities i
     WHERE i.provider = 'email'
       AND lower(coalesce(i.identity_data ->> 'email', '')) = lower(_email)
  ) AS matched
  ORDER BY matched.priority
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_auth_user_id_by_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_auth_user_id_by_email(text) TO service_role;

CREATE OR REPLACE FUNCTION public.reactivate_customer_after_otp(_user_id uuid, _phone text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
        updated_at = now();

  PERFORM set_config('app.users_bypass', 'off', true);
END;
$$;

REVOKE ALL ON FUNCTION public.reactivate_customer_after_otp(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reactivate_customer_after_otp(uuid, text) TO service_role;