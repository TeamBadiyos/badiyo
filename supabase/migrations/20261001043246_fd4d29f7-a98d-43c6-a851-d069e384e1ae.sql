ALTER FUNCTION public.coupon_preview(text, numeric, integer) VOLATILE;
GRANT EXECUTE ON FUNCTION public.coupon_preview(text, numeric, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.coupon_preview(text, numeric, integer) TO authenticated;