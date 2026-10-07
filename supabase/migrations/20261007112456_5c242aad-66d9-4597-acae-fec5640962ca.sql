CREATE OR REPLACE VIEW public.public_products AS
SELECT p.id,
    p.merchant_id,
    p.name,
    p.description,
    p.image_url AS photo_url,
    p.unit,
    p.price,
    NULL::numeric AS mrp,
    COALESCE(p.stock_quantity, 0) > 0 AS in_stock,
    p.category_label AS product_category
   FROM products p
     JOIN public_stores s ON s.id = p.merchant_id
  WHERE p.is_active = true
    AND p.admin_hidden = false
    AND p.approval_status = 'approved';