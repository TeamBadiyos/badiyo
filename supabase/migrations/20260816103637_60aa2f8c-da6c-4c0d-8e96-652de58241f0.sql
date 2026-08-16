-- 1) Self-scope the staff check: only answer for the calling user.
CREATE OR REPLACE FUNCTION public.is_active_staff(_uid uuid, _roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN _uid IS DISTINCT FROM auth.uid() THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.staff_users
       WHERE auth_user_id = _uid
         AND status = 'active'
         AND (_roles IS NULL OR role = ANY(_roles))
    )
  END;
$$;

-- 2) Self-scope the expert-id lookup.
CREATE OR REPLACE FUNCTION public.get_expert_id_for_auth(_auth_uid uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.experts
   WHERE auth_user_id = _auth_uid
     AND _auth_uid IS NOT DISTINCT FROM auth.uid()
   LIMIT 1;
$$;

-- 3) Self-scope caller identity resolution.
CREATE OR REPLACE FUNCTION public.resolve_caller_identity(_auth_uid uuid)
RETURNS TABLE(user_type text, user_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _id uuid;
BEGIN
  IF _auth_uid IS NULL THEN RETURN; END IF;
  -- Only ever resolve the caller's own identity.
  IF _auth_uid IS DISTINCT FROM auth.uid() THEN RETURN; END IF;

  SELECT id INTO _id FROM public.staff_users WHERE auth_user_id = _auth_uid AND status='active' LIMIT 1;
  IF _id IS NOT NULL THEN user_type := 'staff'; user_id := _id; RETURN NEXT; RETURN; END IF;

  SELECT id INTO _id FROM public.experts WHERE auth_user_id = _auth_uid LIMIT 1;
  IF _id IS NOT NULL THEN user_type := 'expert'; user_id := _id; RETURN NEXT; RETURN; END IF;

  SELECT id INTO _id FROM public.users WHERE id = _auth_uid LIMIT 1;
  IF _id IS NOT NULL THEN user_type := 'customer'; user_id := _id; RETURN NEXT; RETURN; END IF;

  SELECT id INTO _id FROM public.merchants WHERE auth_user_id = _auth_uid LIMIT 1;
  IF _id IS NOT NULL THEN user_type := 'merchant'; user_id := _id; RETURN NEXT; RETURN; END IF;
END
$$;

-- 4) Internal-only invoice sequence helper: not part of the client API.
--    merchant_create_offline_sale is SECURITY DEFINER and keeps calling it as owner.
REVOKE EXECUTE ON FUNCTION public.generate_offline_invoice_number(uuid) FROM anon, authenticated;