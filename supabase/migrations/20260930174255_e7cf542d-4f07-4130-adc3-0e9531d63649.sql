
ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS store_slug text;

CREATE OR REPLACE FUNCTION public.store_slugify(_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(
    trim(both '-' from regexp_replace(lower(coalesce(_text, '')), '[^a-z0-9]+', '-', 'g')),
    ''
  );
$$;

CREATE OR REPLACE FUNCTION public.store_unique_slug(_base text, _merchant_id uuid)
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  base text := public.store_slugify(_base);
  candidate text;
  n int := 1;
BEGIN
  IF base IS NULL THEN
    base := 'store';
  END IF;
  candidate := base;
  WHILE EXISTS (
    SELECT 1 FROM public.merchants
    WHERE store_slug = candidate
      AND (_merchant_id IS NULL OR id <> _merchant_id)
  ) LOOP
    n := n + 1;
    candidate := base || '-' || n::text;
  END LOOP;
  RETURN candidate;
END;
$$;

UPDATE public.merchants m
SET store_slug = public.store_unique_slug(
  concat_ws(' ', m.store_name, NULLIF(m.city, '')), m.id
)
WHERE m.store_slug IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS merchants_store_slug_key
  ON public.merchants (store_slug)
  WHERE store_slug IS NOT NULL;

CREATE OR REPLACE FUNCTION public.merchants_fill_store_slug()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.store_slug IS NOT NULL THEN
    NEW.store_slug := public.store_unique_slug(NEW.store_slug, NEW.id);
    RETURN NEW;
  END IF;
  NEW.store_slug := public.store_unique_slug(
    concat_ws(' ', NEW.store_name, NULLIF(NEW.city, '')), NEW.id
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS merchants_fill_store_slug_trg ON public.merchants;
CREATE TRIGGER merchants_fill_store_slug_trg
BEFORE INSERT OR UPDATE OF store_slug, store_name ON public.merchants
FOR EACH ROW EXECUTE FUNCTION public.merchants_fill_store_slug();

CREATE OR REPLACE VIEW public.public_stores AS
SELECT m.id,
    m.store_name,
    m.store_category_id,
    sc.name AS category_name,
    sc.slug AS category_slug,
    m.zone_id,
    m.shop_photo_url AS photo_url,
    NULLIF(btrim(concat_ws(', '::text, NULLIF(m.city, ''::text), NULLIF(m.pincode, ''::text))), ''::text) AS short_address,
    m.latitude AS lat,
    m.longitude AS lng,
    m.is_accepting_orders,
    store_is_open_now(m.id) AS is_open_now,
    NULL::numeric AS rating,
    m.store_slug
   FROM merchants m
     JOIN store_categories sc ON sc.id = m.store_category_id
  WHERE m.status = 'approved'::text AND m.store_category_id IS NOT NULL AND sc.is_active = true;

GRANT SELECT ON public.public_stores TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_set_store_slug(_merchant_id uuid, _slug text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_slug text;
  new_slug text;
BEGIN
  PERFORM public.business_require_super_admin();

  SELECT store_slug INTO old_slug FROM public.merchants WHERE id = _merchant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'merchant not found';
  END IF;

  new_slug := public.store_slugify(_slug);
  IF new_slug IS NULL THEN
    RAISE EXCEPTION 'invalid link name';
  END IF;
  new_slug := public.store_unique_slug(new_slug, _merchant_id);

  UPDATE public.merchants SET store_slug = new_slug, updated_at = now() WHERE id = _merchant_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data)
  VALUES (auth.uid(), 'store_slug_update', 'merchant', _merchant_id,
          jsonb_build_object('store_slug', old_slug),
          jsonb_build_object('store_slug', new_slug));

  RETURN new_slug;
END;
$$;

REVOKE ALL ON FUNCTION public.staff_set_store_slug(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.staff_set_store_slug(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.staff_set_store_slug(uuid, text) TO authenticated;
