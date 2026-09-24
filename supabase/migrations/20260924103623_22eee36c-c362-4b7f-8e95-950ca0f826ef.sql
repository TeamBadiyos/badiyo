-- 1) Customer-safe view over merchants. Security invoker OFF (view owner = postgres,
--    so the underlying merchants RLS is bypassed and only these columns leak out).
CREATE OR REPLACE VIEW public.public_stores
WITH (security_invoker = off) AS
SELECT
  m.id,
  m.store_name,
  m.store_category_id,
  sc.name       AS category_name,
  sc.slug       AS category_slug,
  m.zone_id,
  m.shop_photo_url AS photo_url,
  -- short address: locality/area only, never the full street address
  NULLIF(btrim(concat_ws(', ', NULLIF(m.city, ''), NULLIF(m.pincode, ''))), '') AS short_address,
  m.latitude    AS lat,
  m.longitude   AS lng,
  m.is_accepting_orders,
  NULL::numeric AS rating
FROM public.merchants m
LEFT JOIN public.store_categories sc ON sc.id = m.store_category_id
WHERE m.status = 'approved'
  AND (m.store_category_id IS NULL OR sc.is_active = true);

ALTER VIEW public.public_stores OWNER TO postgres;
REVOKE ALL ON public.public_stores FROM PUBLIC, anon;
GRANT SELECT ON public.public_stores TO authenticated;
GRANT SELECT ON public.public_stores TO service_role;

-- 2) Customer-safe view over products. Hides stock_quantity, low_stock_threshold,
--    gst_rate and hsn_sac_code; exposes only an in_stock boolean.
CREATE OR REPLACE VIEW public.public_products
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
JOIN public.public_stores s ON s.id = p.merchant_id
WHERE p.is_active = true;

ALTER VIEW public.public_products OWNER TO postgres;
REVOKE ALL ON public.public_products FROM PUBLIC, anon;
GRANT SELECT ON public.public_products TO authenticated;
GRANT SELECT ON public.public_products TO service_role;

-- 3) Internal testers list: service-role writes only, no client access at all.
CREATE TABLE IF NOT EXISTS public.internal_testers (
  phone      text PRIMARY KEY,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.internal_testers TO service_role;
-- deliberately no grants to anon/authenticated: the RPC below is the only read path
REVOKE ALL ON public.internal_testers FROM PUBLIC, anon, authenticated;

ALTER TABLE public.internal_testers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service role manages internal testers" ON public.internal_testers;
CREATE POLICY "service role manages internal testers"
  ON public.internal_testers FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 4) is_internal_tester(): true when the caller's phone is on the list.
--    Matches on the last 10 digits so +91/0 prefixes do not break the lookup.
CREATE OR REPLACE FUNCTION public.is_internal_tester()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.internal_testers t
      ON right(regexp_replace(t.phone, '\D', '', 'g'), 10)
       = right(regexp_replace(u.phone, '\D', '', 'g'), 10)
    WHERE u.id = auth.uid()
      AND u.phone IS NOT NULL
  );
$$;

REVOKE ALL ON FUNCTION public.is_internal_tester() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_internal_tester() TO authenticated, service_role;

-- 5) Store goes back to "coming soon" for ordinary customers.
UPDATE public.service_flags
   SET status = 'coming_soon',
       status_updated_at = now(),
       updated_at = now()
 WHERE service_key = 'store';