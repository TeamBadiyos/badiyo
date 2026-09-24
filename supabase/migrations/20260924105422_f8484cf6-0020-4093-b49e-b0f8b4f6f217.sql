-- ops_settings is staff-only. Expose just this one number to the app.
CREATE OR REPLACE FUNCTION public.store_max_radius_km()
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT NULLIF(s.value::numeric, 0) FROM public.ops_settings s WHERE s.key = 'store_max_radius_km'),
    5
  );
$$;

REVOKE ALL ON FUNCTION public.store_max_radius_km() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_max_radius_km() TO authenticated, service_role;