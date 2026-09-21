CREATE OR REPLACE FUNCTION public.bookings_apply_coupon()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.coupon_redemptions%ROWTYPE; _code text; _disc numeric;
BEGIN
  NEW.coupon_id := NULL; NEW.coupon_code := NULL; NEW.discount_amount := 0;
  IF NEW.razorpay_order_id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO r FROM public.coupon_redemptions
   WHERE razorpay_order_id = NEW.razorpay_order_id AND user_id = NEW.user_id
     AND status = 'reserved' ORDER BY created_at LIMIT 1;
  IF r.id IS NULL THEN RETURN NEW; END IF;

  SELECT code INTO _code FROM public.coupons WHERE id = r.coupon_id;
  -- Discount applies to the taxable base (pre-tax price), never to the tax.
  _disc := LEAST(GREATEST(COALESCE(r.discount_amount,0),0), COALESCE(NEW.price,0));
  NEW.coupon_id := r.coupon_id;
  NEW.coupon_code := _code;
  NEW.discount_amount := _disc;
  RETURN NEW;
END; $$;

-- Final pricing pass: GST on the post-discount taxable value, total rounded to whole rupees.
CREATE OR REPLACE FUNCTION public.bookings_finalize_amounts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _taxable numeric; _gst numeric;
BEGIN
  _taxable := GREATEST(COALESCE(NEW.price,0) - COALESCE(NEW.discount_amount,0), 0);
  _gst := round(_taxable * COALESCE(NEW.gst_percent,0) / 100.0, 2);
  NEW.gst_amount := _gst;
  NEW.total_amount := round(_taxable + _gst);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_zz_bookings_finalize_amounts ON public.bookings;
CREATE TRIGGER trg_zz_bookings_finalize_amounts BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_finalize_amounts();