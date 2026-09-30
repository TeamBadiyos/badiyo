CREATE OR REPLACE FUNCTION public.coins_release_stale_reservations()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r record; _n integer := 0;
BEGIN
  -- Mark reservations whose booking exists as consumed
  UPDATE public.coin_redemptions cr SET status = 'consumed'
  WHERE cr.status = 'reserved'
    AND EXISTS (SELECT 1 FROM public.bookings b WHERE b.razorpay_order_id = cr.razorpay_order_id);
  -- Refund reservations older than 30 min with no booking
  FOR _r IN SELECT razorpay_order_id FROM public.coin_redemptions
    WHERE status = 'reserved' AND created_at < now() - interval '30 minutes'
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.razorpay_order_id = _r.razorpay_order_id) THEN
      PERFORM public.system_coins_release(_r.razorpay_order_id);
      _n := _n + 1;
    END IF;
  END LOOP;
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION public.coins_release_stale_reservations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coins_release_stale_reservations() TO service_role;

SELECT cron.unschedule('coins-release-stale') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='coins-release-stale');
SELECT cron.schedule('coins-release-stale', '0 * * * *', $$SELECT public.coins_release_stale_reservations();$$);