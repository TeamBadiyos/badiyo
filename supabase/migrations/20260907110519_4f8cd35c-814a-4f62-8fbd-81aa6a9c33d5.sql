CREATE OR REPLACE FUNCTION public.customer_delete_account()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  PERFORM set_config('app.users_bypass', 'on', true);

  UPDATE public.users
     SET full_name = 'Deleted user',
         email = NULL,
         phone = NULL,
         avatar_url = NULL,
         pin_hash = NULL,
         referral_code = NULL,
         referred_by = NULL,
         deleted_at = now(),
         updated_at = now()
   WHERE id = _uid;

  PERFORM set_config('app.users_bypass', 'off', true);

  UPDATE public.addresses
     SET label = NULL,
         full_address = 'Removed',
         landmark_photo_url = NULL
   WHERE user_id = _uid;

  DELETE FROM public.device_tokens WHERE user_type = 'customer' AND user_id = _uid;
  DELETE FROM public.device_sessions WHERE user_type = 'customer' AND user_id = _uid;

  BEGIN
    UPDATE auth.users
       SET phone = NULL,
           email = NULL,
           banned_until = 'infinity'::timestamptz
     WHERE id = _uid;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[customer_delete_account] auth cleanup failed for %: %', _uid, SQLERRM;
  END;

  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, after_state)
  VALUES (_uid, 'customer_account_deleted', 'users', _uid, jsonb_build_object('deleted_at', now()));
END $function$;