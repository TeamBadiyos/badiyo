CREATE OR REPLACE FUNCTION public.store_my_orders()
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'created_at' DESC), '[]'::jsonb) FROM (
    SELECT jsonb_build_object(
      'id', o.id, 'order_number', o.order_number, 'status', o.status,
      'payment_mode', o.payment_mode, 'payment_status', o.payment_status,
      'items_total', o.items_total, 'delivery_fee', o.delivery_fee, 'total_amount', o.total_amount,
      'delivery_address', o.delivery_address, 'created_at', o.created_at,
      'courier_order_id', o.courier_order_id, 'reject_reason', o.reject_reason,
      'cancel_reason', o.cancel_reason, 'refund_status', o.refund_status,
      'store_name', m.store_name, 'store_photo_url', m.shop_photo_url,
      'items', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', i.product_name_snapshot,
          'price', i.price_snapshot, 'quantity', i.quantity))
        FROM public.merchant_order_items i WHERE i.order_id = o.id), '[]'::jsonb)
    ) AS x
    FROM public.merchant_orders o JOIN public.merchants m ON m.id = o.merchant_id
    WHERE o.user_id = auth.uid()
    ORDER BY o.created_at DESC LIMIT 100
  ) s;
$function$;
revoke all on function public.store_my_orders() from public, anon;
grant execute on function public.store_my_orders() to authenticated, service_role;