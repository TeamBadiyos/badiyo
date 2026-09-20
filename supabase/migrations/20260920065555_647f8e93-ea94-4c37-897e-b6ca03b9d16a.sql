CREATE TABLE IF NOT EXISTS public.courier_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id uuid NOT NULL UNIQUE REFERENCES public.zones(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.courier_zones TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.courier_zones TO authenticated;
GRANT ALL ON public.courier_zones TO service_role;

ALTER TABLE public.courier_zones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "courier zones public read active"
  ON public.courier_zones FOR SELECT TO anon, authenticated
  USING (is_active = true);

CREATE POLICY "courier zones staff read"
  ON public.courier_zones FOR SELECT TO authenticated
  USING (public.courier_is_ops_staff());

CREATE POLICY "courier zones super admin write"
  ON public.courier_zones FOR ALL TO authenticated
  USING (public.courier_is_super_admin())
  WITH CHECK (public.courier_is_super_admin());

CREATE TRIGGER courier_zones_set_updated_at
  BEFORE UPDATE ON public.courier_zones
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Is this point inside a zone that courier is mapped to?
-- Until at least one zone is mapped, any active zone counts (keeps the
-- current behaviour working while the command centre mapping is set up).
CREATE OR REPLACE FUNCTION public.courier_check_serviceability(_lat numeric, _lng numeric)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _mapped boolean;
  _zone_id uuid;
  _zone_name text;
BEGIN
  IF _lat IS NULL OR _lng IS NULL THEN
    RETURN jsonb_build_object('serviceable', false, 'zone_id', null, 'zone_name', null);
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.courier_zones cz WHERE cz.is_active) INTO _mapped;

  SELECT z.id, z.name INTO _zone_id, _zone_name
  FROM public.zones z
  WHERE z.status = 'active'
    AND z.deleted_at IS NULL
    AND (
      NOT _mapped
      OR EXISTS (SELECT 1 FROM public.courier_zones cz WHERE cz.zone_id = z.id AND cz.is_active)
    )
    AND public.point_in_polygon(_lat, _lng, z.boundary)
  LIMIT 1;

  RETURN jsonb_build_object(
    'serviceable', _zone_id IS NOT NULL,
    'zone_id', _zone_id,
    'zone_name', _zone_name
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.courier_check_serviceability(numeric, numeric) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.courier_check_serviceability(numeric, numeric) TO authenticated, service_role;