INSERT INTO public.ops_settings (key, label, value)
VALUES ('gst_percent', 'GST percentage applied on top of service prices', '5')
ON CONFLICT (key) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'ops_settings' AND cmd = 'UPDATE'
  ) THEN
    EXECUTE $p$CREATE POLICY "Admins can update ops settings" ON public.ops_settings
      FOR UPDATE TO authenticated
      USING (is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']))
      WITH CHECK (is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']))$p$;
  END IF;
END $$;

GRANT UPDATE ON public.ops_settings TO authenticated;
GRANT ALL ON public.ops_settings TO service_role;

CREATE OR REPLACE FUNCTION public.get_gst_percent()
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT NULLIF(regexp_replace(value, '[^0-9.]', '', 'g'), '')::numeric
       FROM public.ops_settings WHERE key = 'gst_percent'),
    5
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_gst_percent() TO anon, authenticated, service_role;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS gst_percent numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gst_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_amount numeric NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.bookings_before_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _price numeric;
  _addr_lat numeric;
  _addr_lng numeric;
  _bypass text;
  _cat uuid;
  _gst numeric;
BEGIN
  BEGIN _bypass := current_setting('app.booking_bypass', true); EXCEPTION WHEN OTHERS THEN _bypass := NULL; END;

  SELECT price INTO _price FROM public.service_catalogue_config
   WHERE duration_minutes = NEW.service_duration_minutes AND is_active = true
   ORDER BY created_at DESC LIMIT 1;

  IF _price IS NULL THEN
    SELECT spo.customer_price INTO _price
      FROM public.service_price_options spo
      JOIN public.services sv ON sv.id = spo.service_id
     WHERE spo.is_active = true AND sv.is_active = true
       AND lower(spo.label) = lower(COALESCE(NEW.service_label, ''))
     ORDER BY spo.display_order
     LIMIT 1;
  END IF;

  IF _price IS NULL AND NEW.service_duration_minutes IS NOT NULL THEN
    SELECT spo.customer_price INTO _price
      FROM public.service_price_options spo
      JOIN public.services sv ON sv.id = spo.service_id
     WHERE spo.is_active = true AND sv.is_active = true
       AND spo.duration_minutes = NEW.service_duration_minutes
     ORDER BY spo.display_order
     LIMIT 1;
  END IF;

  IF _price IS NULL THEN
    RAISE EXCEPTION 'Invalid service duration';
  END IF;
  NEW.price := _price;

  _gst := COALESCE(public.get_gst_percent(), 0);
  IF _gst < 0 OR _gst > 100 THEN _gst := 0; END IF;
  NEW.gst_percent := _gst;
  NEW.gst_amount := round(_price * _gst / 100.0, 2);
  NEW.total_amount := _price + NEW.gst_amount;

  NEW.status := 'confirmed';
  NEW.rating := NULL;
  NEW.review_text := NULL;

  IF _bypass IS DISTINCT FROM 'on' THEN
    NEW.assigned_expert_id := NULL;
    NEW.refund_id := NULL;
    NEW.refund_status := NULL;
    NEW.refund_amount := NULL;
    NEW.cancellation_fee := NULL;
    NEW.cancellation_reason := NULL;
    NEW.cancelled_by := NULL;
    NEW.cancelled_at := NULL;
    NEW.started_at := NULL;
    NEW.service_end_at := NULL;
    NEW.start_otp := NULL;
    NEW.end_otp := NULL;
    NEW.broadcast_started_at := NULL;
    NEW.current_search_radius_km := NULL;
    NEW.deleted_at := NULL;
    NEW.deleted_by := NULL;
    NEW.delete_reason := NULL;
  END IF;

  IF NEW.service_category_id IS NULL THEN
    SELECT sv.category_id INTO _cat
      FROM public.service_price_options spo
      JOIN public.services sv ON sv.id = spo.service_id
      JOIN public.service_categories sc ON sc.id = sv.category_id
     WHERE spo.is_active = true AND sv.is_active = true AND sc.is_active = true
       AND lower(spo.label) = lower(COALESCE(NEW.service_label, ''))
     ORDER BY spo.display_order
     LIMIT 1;

    IF _cat IS NULL AND NEW.service_duration_minutes IS NOT NULL THEN
      SELECT sv.category_id INTO _cat
        FROM public.service_price_options spo
        JOIN public.services sv ON sv.id = spo.service_id
        JOIN public.service_categories sc ON sc.id = sv.category_id
       WHERE spo.is_active = true AND sv.is_active = true AND sc.is_active = true
         AND spo.duration_minutes = NEW.service_duration_minutes
       ORDER BY spo.display_order
       LIMIT 1;
    END IF;

    IF _cat IS NULL THEN
      SELECT scc.service_category_id INTO _cat
        FROM public.service_catalogue_config scc
       WHERE scc.is_active = true
         AND scc.duration_minutes = NEW.service_duration_minutes
         AND scc.service_category_id IS NOT NULL
       ORDER BY scc.created_at DESC
       LIMIT 1;
    END IF;

    NEW.service_category_id := _cat;
  END IF;

  IF (NEW.booking_lat IS NULL OR NEW.booking_lng IS NULL) AND NEW.address_id IS NOT NULL THEN
    SELECT latitude, longitude INTO _addr_lat, _addr_lng
      FROM public.addresses WHERE id = NEW.address_id;
    IF NEW.booking_lat IS NULL THEN NEW.booking_lat := _addr_lat; END IF;
    IF NEW.booking_lng IS NULL THEN NEW.booking_lng := _addr_lng; END IF;
  END IF;

  IF NEW.booking_lat IS NULL OR NEW.booking_lng IS NULL THEN
    RAISE EXCEPTION 'Booking requires geographic coordinates: booking_lat/booking_lng were not provided and could not be resolved from address_id %', NEW.address_id
      USING ERRCODE = 'check_violation', HINT = 'Ensure the selected address has latitude/longitude, or pass booking_lat/booking_lng explicitly.';
  END IF;

  RETURN NEW;
END;
$function$;