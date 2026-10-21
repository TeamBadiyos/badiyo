CREATE OR REPLACE FUNCTION public.get_customer_auth_id_by_phone(_phone text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT u.id FROM public.users u
   WHERE length(regexp_replace(coalesce(_phone,''), '\D', '', 'g')) >= 10
     AND right(regexp_replace(coalesce(u.phone,''), '\D', '', 'g'), 10)
       = right(regexp_replace(coalesce(_phone,''), '\D', '', 'g'), 10)
   ORDER BY (u.deleted_at IS NULL) DESC, (u.pin_hash IS NOT NULL) DESC,
            (u.full_name IS NOT NULL) DESC, u.created_at ASC
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.get_customer_auth_id_by_phone(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_auth_id_by_phone(text) TO service_role;