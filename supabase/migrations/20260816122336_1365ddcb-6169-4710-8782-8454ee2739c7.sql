CREATE OR REPLACE FUNCTION public.customer_update_address(
  p_address_id uuid,
  p_label text,
  p_full_address text,
  p_area text,
  p_city text,
  p_latitude numeric,
  p_longitude numeric,
  p_landmark_photo_url text DEFAULT NULL
)
RETURNS public.addresses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.addresses;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.addresses a
     SET label = COALESCE(p_label, a.label),
         full_address = COALESCE(NULLIF(btrim(p_full_address), ''), a.full_address),
         area = p_area,
         city = p_city,
         latitude = COALESCE(p_latitude, a.latitude),
         longitude = COALESCE(p_longitude, a.longitude),
         landmark_photo_url = COALESCE(p_landmark_photo_url, a.landmark_photo_url)
   WHERE a.id = p_address_id
     AND a.user_id = v_uid
  RETURNING a.* INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Address not found';
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.customer_delete_address(p_address_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_deleted int;
  v_was_default boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT is_default INTO v_was_default
    FROM public.addresses
   WHERE id = p_address_id AND user_id = v_uid;

  IF v_was_default IS NULL AND NOT EXISTS (
    SELECT 1 FROM public.addresses WHERE id = p_address_id AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Address not found';
  END IF;

  DELETE FROM public.addresses
   WHERE id = p_address_id AND user_id = v_uid;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted > 0 AND COALESCE(v_was_default, false) THEN
    UPDATE public.addresses
       SET is_default = true
     WHERE id = (
       SELECT id FROM public.addresses
        WHERE user_id = v_uid
        ORDER BY created_at DESC
        LIMIT 1
     );
  END IF;

  RETURN v_deleted > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.customer_update_address(uuid, text, text, text, text, numeric, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.customer_delete_address(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_update_address(uuid, text, text, text, text, numeric, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.customer_delete_address(uuid) TO authenticated;