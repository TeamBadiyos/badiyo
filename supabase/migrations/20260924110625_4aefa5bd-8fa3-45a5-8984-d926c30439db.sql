CREATE OR REPLACE VIEW public.public_stores AS
SELECT
  m.id,
  m.store_name,
  m.store_category_id,
  sc.name AS category_name,
  sc.slug AS category_slug,
  m.zone_id,
  m.shop_photo_url AS photo_url,
  NULLIF(btrim(concat_ws(', ', NULLIF(m.city, ''), NULLIF(m.pincode, ''))), '') AS short_address,
  m.latitude AS lat,
  m.longitude AS lng,
  m.is_accepting_orders,
  public.store_is_open_now(m.id) AS is_open_now,
  NULL::numeric AS rating
FROM public.merchants m
JOIN public.store_categories sc ON sc.id = m.store_category_id
WHERE m.status = 'approved'
  AND m.store_category_id IS NOT NULL
  AND sc.is_active = true;

GRANT SELECT ON public.public_stores TO authenticated;
GRANT SELECT ON public.public_stores TO service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'admin_hidden'
  ) THEN
    EXECUTE $v$
      CREATE OR REPLACE VIEW public.public_products AS
      SELECT
        p.id,
        p.merchant_id,
        p.name,
        p.description,
        p.image_url AS photo_url,
        p.unit,
        p.price,
        NULL::numeric AS mrp,
        (COALESCE(p.stock_quantity, 0) > 0) AS in_stock,
        p.category_label AS product_category
      FROM public.products p
      JOIN public.public_stores s ON s.id = p.merchant_id
      WHERE p.is_active = true
        AND p.admin_hidden = false
    $v$;
    EXECUTE 'GRANT SELECT ON public.public_products TO authenticated';
    EXECUTE 'GRANT SELECT ON public.public_products TO service_role';
  END IF;
END $$;

REVOKE TRUNCATE ON public.merchants FROM anon, authenticated;
REVOKE TRUNCATE ON public.products FROM anon, authenticated;