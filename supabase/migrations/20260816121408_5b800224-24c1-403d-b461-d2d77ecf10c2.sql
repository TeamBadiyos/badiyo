CREATE OR REPLACE FUNCTION public.set_login_pin(p_pin text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_hash text;
  v_updated int := 0;
  v_is_expert boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_pin !~ '^\d{4}$' THEN
    RAISE EXCEPTION 'PIN must be 4 digits';
  END IF;

  v_hash := crypt(p_pin, gen_salt('bf'));

  -- Branch strictly on caller identity. A customer must never touch
  -- public.experts (that path is for the Partner app only).
  SELECT EXISTS(SELECT 1 FROM public.experts e WHERE e.auth_user_id = v_uid)
    INTO v_is_expert;

  IF v_is_expert THEN
    UPDATE public.experts
       SET pin_hash = v_hash
     WHERE auth_user_id = v_uid;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
      RAISE EXCEPTION 'User profile not found';
    END IF;
    RETURN;
  END IF;

  PERFORM set_config('app.users_bypass', 'on', true);
  UPDATE public.users
     SET pin_hash = v_hash
   WHERE id = v_uid;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  PERFORM set_config('app.users_bypass', 'off', true);

  IF v_updated = 0 THEN
    RAISE EXCEPTION 'User profile not found';
  END IF;
END;
$function$;