CREATE OR REPLACE FUNCTION public.bookings_release_coupon_on_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE n integer := 0;
BEGIN
  IF NEW.status <> 'cancelled' OR COALESCE(OLD.status,'') = 'cancelled' THEN
    RETURN NEW;
  END IF;

  -- Free any reservation/redemption tied to this booking (or its payment order).
  UPDATE public.coupon_redemptions
     SET status = 'released', updated_at = now()
   WHERE user_id = NEW.user_id
     AND status IN ('reserved','applied')
     AND (
       booking_id = NEW.id
       OR (NEW.razorpay_order_id IS NOT NULL AND razorpay_order_id = NEW.razorpay_order_id)
     );
  GET DIAGNOSTICS n = ROW_COUNT;

  IF n > 0 AND NEW.coupon_id IS NOT NULL THEN
    UPDATE public.coupons
       SET used_count = GREATEST(COALESCE(used_count,0) - n, 0)
     WHERE id = NEW.coupon_id;

    UPDATE public.customer_coupons
       SET status = 'available', used_at = NULL
     WHERE coupon_id = NEW.coupon_id
       AND user_id = NEW.user_id
       AND status = 'used';
  END IF;

  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS trg_zz_bookings_release_coupon_on_cancel ON public.bookings;
CREATE TRIGGER trg_zz_bookings_release_coupon_on_cancel
AFTER UPDATE OF status ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.bookings_release_coupon_on_cancel();