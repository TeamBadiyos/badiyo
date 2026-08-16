CREATE OR REPLACE FUNCTION public.has_login_pin(p_phone text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _digits text := right(regexp_replace(coalesce(p_phone,''), '\D', '', 'g'), 10);
  _exists boolean := false;
BEGIN
  IF length(_digits) <> 10 THEN RETURN false; END IF;
  SELECT EXISTS(
    SELECT 1 FROM public.users u
    WHERE right(regexp_replace(coalesce(u.phone,''), '\D', '', 'g'), 10) = _digits
      AND u.pin_hash IS NOT NULL
  ) INTO _exists;
  RETURN _exists;
END;
$$;

REVOKE ALL ON FUNCTION public.has_login_pin(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_login_pin(text) TO service_role;