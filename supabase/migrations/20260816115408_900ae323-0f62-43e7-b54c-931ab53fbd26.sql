CREATE OR REPLACE FUNCTION public.verify_login_pin(p_phone text, p_pin text, p_user_type text)
 RETURNS TABLE(auth_user_id uuid, status text, retry_after_seconds integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _phone text := regexp_replace(coalesce(p_phone,''), '\D', '', 'g');
  _hash text;
  _auth_id uuid;
  _lock record;
  _match boolean := false;
  _new_attempts int;
BEGIN
  auth_user_id := NULL; status := 'invalid'; retry_after_seconds := 0;

  IF _phone = '' OR p_pin IS NULL OR p_pin !~ '^[0-9]{4}$' THEN RETURN NEXT; RETURN; END IF;
  IF p_user_type NOT IN ('customer','expert') THEN RETURN NEXT; RETURN; END IF;

  SELECT * INTO _lock FROM public.pin_login_lockouts WHERE phone = _phone;
  IF _lock.phone IS NOT NULL AND _lock.locked_until IS NOT NULL AND _lock.locked_until > now() THEN
    status := 'locked';
    retry_after_seconds := GREATEST(1, EXTRACT(EPOCH FROM (_lock.locked_until - now()))::int);
    RETURN NEXT; RETURN;
  END IF;

  IF p_user_type = 'expert' THEN
    SELECT e.pin_hash, e.auth_user_id INTO _hash, _auth_id
      FROM public.experts e
     WHERE regexp_replace(coalesce(e.phone,''), '\D', '', 'g') = _phone
       AND e.status = 'active'
       AND e.auth_user_id IS NOT NULL
     ORDER BY (e.pin_hash IS NOT NULL) DESC, e.created_at DESC
     LIMIT 1;
  ELSE
    -- Duplicate customer rows can exist for one phone (e.g. an older anonymous
    -- signup). Always prefer the row that actually carries a PIN hash, then the
    -- most recent one, so login never matches against a stale empty profile.
    SELECT u.pin_hash, u.id INTO _hash, _auth_id
      FROM public.users u
     WHERE regexp_replace(coalesce(u.phone,''), '\D', '', 'g') = _phone
     ORDER BY (u.pin_hash IS NOT NULL) DESC, u.created_at DESC
     LIMIT 1;
  END IF;

  IF _hash IS NOT NULL AND _auth_id IS NOT NULL THEN
    _match := (_hash = crypt(p_pin, _hash));
  END IF;

  IF _match THEN
    DELETE FROM public.pin_login_lockouts WHERE phone = _phone;
    auth_user_id := _auth_id;
    status := 'ok';
    RETURN NEXT; RETURN;
  END IF;

  INSERT INTO public.pin_login_lockouts(phone, failed_attempts, updated_at)
    VALUES(_phone, 1, now())
  ON CONFLICT (phone) DO UPDATE
    SET failed_attempts = public.pin_login_lockouts.failed_attempts + 1,
        updated_at = now()
  RETURNING failed_attempts INTO _new_attempts;

  IF _new_attempts >= 5 THEN
    UPDATE public.pin_login_lockouts
       SET locked_until = now() + interval '15 minutes',
           failed_attempts = 0,
           updated_at = now()
     WHERE phone = _phone;
    status := 'locked';
    retry_after_seconds := 15 * 60;
    RETURN NEXT; RETURN;
  END IF;

  status := 'invalid';
  RETURN NEXT; RETURN;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.verify_login_pin(text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_login_pin(text, text, text) TO service_role;

-- Clear any lockout accumulated while the bug was reproducing.
DELETE FROM public.pin_login_lockouts;