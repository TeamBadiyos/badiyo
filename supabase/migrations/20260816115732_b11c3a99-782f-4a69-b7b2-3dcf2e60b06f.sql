-- 1. Prevent two customer profiles sharing one phone number (normalized digits).
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_digits_unique
  ON public.users ((regexp_replace(coalesce(phone,''), '\D', '', 'g')))
  WHERE phone IS NOT NULL AND phone <> '';

-- 2. Let the OTP login flow find an existing customer profile by phone so it
--    reuses that auth identity instead of minting a second account.
CREATE OR REPLACE FUNCTION public.get_customer_auth_id_by_phone(_phone text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT u.id
    FROM public.users u
   WHERE regexp_replace(coalesce(u.phone,''), '\D', '', 'g')
       = regexp_replace(coalesce(_phone,''), '\D', '', 'g')
     AND coalesce(_phone,'') <> ''
   ORDER BY (u.pin_hash IS NOT NULL) DESC, u.created_at DESC
   LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.get_customer_auth_id_by_phone(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_auth_id_by_phone(text) TO service_role;