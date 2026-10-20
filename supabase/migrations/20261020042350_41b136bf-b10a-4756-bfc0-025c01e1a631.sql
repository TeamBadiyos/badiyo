CREATE OR REPLACE FUNCTION public.app_change_booking_address(_booking_id uuid, _address_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b public.bookings; a public.addresses; _city uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT * INTO b FROM public.bookings WHERE id = _booking_id AND user_id = auth.uid() AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF b.assigned_expert_id IS NOT NULL OR b.status NOT IN ('pending','accepted','confirmed') THEN
    RAISE EXCEPTION 'Address can no longer be changed for this booking';
  END IF;
  SELECT * INTO a FROM public.addresses WHERE id = _address_id AND user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Address not found'; END IF;
  IF a.latitude IS NULL OR a.longitude IS NULL THEN RAISE EXCEPTION 'Please pin this address on the map first'; END IF;
  _city := public.app_city_for_location(a.latitude, a.longitude);
  IF b.city_id IS NOT NULL AND (_city IS NULL OR _city <> b.city_id) THEN
    RAISE EXCEPTION 'New address must be in the same city';
  END IF;
  PERFORM set_config('app.booking_bypass','on',true);
  UPDATE public.bookings SET address_id = a.id, booking_lat = a.latitude, booking_lng = a.longitude, updated_at = now() WHERE id = b.id;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.app_change_booking_address(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_change_booking_address(uuid, uuid) TO authenticated;