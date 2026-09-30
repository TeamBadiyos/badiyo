
-- 1. Lifetime phone registry
CREATE TABLE IF NOT EXISTS public.referral_phone_registry (
  phone text PRIMARY KEY,
  first_user_id uuid,
  last_user_id uuid,
  referral_used boolean NOT NULL DEFAULT false,
  referred_by_code text,
  is_deleted_account boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.referral_phone_registry TO service_role;
ALTER TABLE public.referral_phone_registry ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role manages referral phone registry" ON public.referral_phone_registry;
CREATE POLICY "service role manages referral phone registry"
  ON public.referral_phone_registry FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2. Deleted accounts registry
CREATE TABLE IF NOT EXISTS public.deleted_accounts_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text,
  original_user_id uuid NOT NULL,
  had_referred_by text,
  deleted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS deleted_accounts_registry_phone_idx ON public.deleted_accounts_registry(phone);

GRANT ALL ON public.deleted_accounts_registry TO service_role;
ALTER TABLE public.deleted_accounts_registry ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role manages deleted accounts registry" ON public.deleted_accounts_registry;
CREATE POLICY "service role manages deleted accounts registry"
  ON public.deleted_accounts_registry FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3. Phone normalizer
CREATE OR REPLACE FUNCTION public.referral_phone10(_phone text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT NULLIF(right(regexp_replace(COALESCE(_phone,''), '\D', '', 'g'), 10), '')
$$;

CREATE OR REPLACE FUNCTION public.referral_registry_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS referral_phone_registry_touch ON public.referral_phone_registry;
CREATE TRIGGER referral_phone_registry_touch BEFORE UPDATE ON public.referral_phone_registry
FOR EACH ROW EXECUTE FUNCTION public.referral_registry_touch();

-- 4. Backfill existing customers
INSERT INTO public.referral_phone_registry (phone, first_user_id, last_user_id, referral_used, referred_by_code, is_deleted_account)
SELECT p.phone10, min(u.id::text)::uuid, min(u.id::text)::uuid,
       bool_or(u.referred_by IS NOT NULL),
       max(u.referred_by),
       bool_or(u.deleted_at IS NOT NULL)
FROM public.users u
CROSS JOIN LATERAL (SELECT public.referral_phone10(u.phone) AS phone10) p
WHERE p.phone10 IS NOT NULL
GROUP BY p.phone10
ON CONFLICT (phone) DO NOTHING;

-- 5. Delete account: register phone, keep referral link
CREATE OR REPLACE FUNCTION public.customer_delete_account()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  _uid uuid := auth.uid();
  _phone10 text;
  _ref text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT public.referral_phone10(phone), referred_by INTO _phone10, _ref
    FROM public.users WHERE id = _uid;

  IF _phone10 IS NOT NULL THEN
    INSERT INTO public.referral_phone_registry (phone, first_user_id, last_user_id, referral_used, referred_by_code, is_deleted_account)
    VALUES (_phone10, _uid, _uid, _ref IS NOT NULL, _ref, true)
    ON CONFLICT (phone) DO UPDATE
      SET is_deleted_account = true,
          last_user_id = EXCLUDED.last_user_id,
          referral_used = public.referral_phone_registry.referral_used OR EXCLUDED.referral_used,
          referred_by_code = COALESCE(public.referral_phone_registry.referred_by_code, EXCLUDED.referred_by_code);
  END IF;

  INSERT INTO public.deleted_accounts_registry (phone, original_user_id, had_referred_by)
  VALUES (_phone10, _uid, _ref);

  PERFORM set_config('app.users_bypass', 'on', true);

  UPDATE public.users
     SET full_name = 'Deleted user',
         email = NULL,
         phone = NULL,
         avatar_url = NULL,
         pin_hash = NULL,
         referral_code = NULL,
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
           banned_until = timestamptz '2999-01-01'
     WHERE id = _uid;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[customer_delete_account] auth cleanup failed for %: %', _uid, SQLERRM;
  END;

  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, after_state)
  VALUES (_uid, 'customer_account_deleted', 'users', _uid, jsonb_build_object('deleted_at', now()));
END
$function$;

-- 6. Referral guard
CREATE OR REPLACE FUNCTION public.apply_referral_code(_code text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  _uid uuid := auth.uid();
  _referrer_id uuid;
  _current_ref text;
  _txn_id uuid;
  _phone10 text;
  _reg record;
BEGIN
  IF _uid IS NULL THEN RETURN 'not_authenticated'; END IF;
  IF _code IS NULL OR length(trim(_code)) = 0 THEN RETURN 'invalid_code'; END IF;

  SELECT referred_by, public.referral_phone10(phone) INTO _current_ref, _phone10
    FROM public.users WHERE id = _uid;
  IF _current_ref IS NOT NULL AND length(_current_ref) > 0 THEN RETURN 'already_referred'; END IF;

  IF _phone10 IS NOT NULL THEN
    SELECT * INTO _reg FROM public.referral_phone_registry WHERE phone = _phone10;
    IF FOUND THEN
      IF _reg.referral_used OR _reg.is_deleted_account
         OR (_reg.first_user_id IS NOT NULL AND _reg.first_user_id <> _uid) THEN
        RETURN 'not_eligible_existing_user';
      END IF;
    END IF;
    IF EXISTS (SELECT 1 FROM public.deleted_accounts_registry WHERE phone = _phone10) THEN
      RETURN 'not_eligible_existing_user';
    END IF;
  END IF;

  SELECT id INTO _referrer_id FROM public.users
   WHERE upper(referral_code) = upper(trim(_code)) LIMIT 1;
  IF _referrer_id IS NULL THEN RETURN 'invalid_code'; END IF;
  IF _referrer_id = _uid THEN RETURN 'self_referral'; END IF;

  PERFORM set_config('app.users_bypass', 'on', true);
  UPDATE public.users SET referred_by = upper(trim(_code)) WHERE id = _uid;
  PERFORM set_config('app.users_bypass', 'off', true);

  IF _phone10 IS NOT NULL THEN
    INSERT INTO public.referral_phone_registry (phone, first_user_id, last_user_id, referral_used, referred_by_code)
    VALUES (_phone10, _uid, _uid, true, upper(trim(_code)))
    ON CONFLICT (phone) DO UPDATE
      SET referral_used = true,
          last_user_id = EXCLUDED.last_user_id,
          referred_by_code = COALESCE(public.referral_phone_registry.referred_by_code, EXCLUDED.referred_by_code);
  END IF;

  SELECT id INTO _txn_id FROM public.referral_transactions WHERE referred_user_id = _uid LIMIT 1;
  IF _txn_id IS NULL THEN
    INSERT INTO public.referral_transactions (referrer_id, referred_user_id, status)
    VALUES (_referrer_id, _uid, 'pending')
    RETURNING id INTO _txn_id;
  END IF;

  PERFORM public.credit_referral_signup(_txn_id);

  PERFORM public.evaluate_reward_triggers('customer', _referrer_id, 'referral_signup', _uid::text,
    jsonb_build_object('referred_user_id', _uid));

  RETURN 'applied';
END;
$function$;

-- 7. Register phone on first profile write (new signups)
CREATE OR REPLACE FUNCTION public.users_register_phone()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE _p text;
BEGIN
  _p := public.referral_phone10(NEW.phone);
  IF _p IS NOT NULL THEN
    INSERT INTO public.referral_phone_registry (phone, first_user_id, last_user_id)
    VALUES (_p, NEW.id, NEW.id)
    ON CONFLICT (phone) DO UPDATE SET last_user_id = EXCLUDED.last_user_id;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS users_register_phone_trg ON public.users;
CREATE TRIGGER users_register_phone_trg
AFTER INSERT OR UPDATE OF phone ON public.users
FOR EACH ROW EXECUTE FUNCTION public.users_register_phone();
