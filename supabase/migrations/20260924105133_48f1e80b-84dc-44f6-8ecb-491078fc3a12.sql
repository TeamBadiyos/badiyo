-- The customer-facing views run as postgres for table access, but function
-- EXECUTE is still checked against the calling role. Expose a thin, read-only
-- wrapper the customer app may execute, instead of widening the merchant-side
-- function's own grants.
CREATE OR REPLACE FUNCTION public.store_is_open_now(_merchant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.merchant_is_currently_open(_merchant_id);
$$;

REVOKE ALL ON FUNCTION public.store_is_open_now(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_is_open_now(uuid) TO authenticated, service_role;

DROP VIEW IF EXISTS public.public_products;
DROP VIEW IF EXISTS public.public_stores;

CREATE VIEW public.public_stores
WITH (security_invoker = off) AS
SELECT
  m.id,
  m.store_name,
  m.store_category_id,
  sc.name       AS category_name,
  sc.slug       AS category_slug,
  m.zone_id,
  m.shop_photo_url AS photo_url,
  NULLIF(btrim(concat_ws(', ', NULLIF(m.city, ''), NULLIF(m.pincode, ''))), '') AS short_address,
  m.latitude    AS lat,
  m.longitude   AS lng,
  m.is_accepting_orders,
  public.store_is_open_now(m.id) AS is_open_now,
  NULL::numeric AS rating
FROM public.merchants m
LEFT JOIN public.store_categories sc ON sc.id = m.store_category_id
WHERE m.status = 'approved'
  AND (m.store_category_id IS NULL OR sc.is_active = true);

ALTER VIEW public.public_stores OWNER TO postgres;
REVOKE ALL ON public.public_stores FROM PUBLIC, anon;
GRANT SELECT ON public.public_stores TO authenticated;
GRANT SELECT ON public.public_stores TO service_role;

CREATE VIEW public.public_products
WITH (security_invoker = off) AS
SELECT
  p.id,
  p.merchant_id,
  p.name,
  p.description,
  p.image_url      AS photo_url,
  p.unit,
  p.price,
  NULL::numeric    AS mrp,
  (COALESCE(p.stock_quantity, 0) > 0) AS in_stock,
  p.category_label AS product_category
FROM public.products p
WHERE p.is_active = true
  AND p.merchant_id IN (SELECT s.id FROM public.public_stores s);

ALTER VIEW public.public_products OWNER TO postgres;
REVOKE ALL ON public.public_products FROM PUBLIC, anon;
GRANT SELECT ON public.public_products TO authenticated;
GRANT SELECT ON public.public_products TO service_role;