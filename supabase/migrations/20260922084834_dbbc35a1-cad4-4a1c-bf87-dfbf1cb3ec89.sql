ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS latest_version_code INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS min_supported_version_code INT NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.staff_set_app_versions(
  _current_version text DEFAULT NULL,
  _min_supported_version text DEFAULT NULL,
  _latest_version_code int DEFAULT NULL,
  _min_supported_version_code int DEFAULT NULL,
  _play_store_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _before jsonb; _after jsonb;
BEGIN
  PERFORM public.staff_require_super_admin();

  SELECT to_jsonb(c) INTO _before FROM public.app_config c WHERE id = 1;
  IF _before IS NULL THEN RAISE EXCEPTION 'app_config row missing'; END IF;

  IF _latest_version_code IS NOT NULL AND _latest_version_code < 1 THEN
    RAISE EXCEPTION 'latest_version_code must be >= 1';
  END IF;
  IF _min_supported_version_code IS NOT NULL AND _min_supported_version_code < 1 THEN
    RAISE EXCEPTION 'min_supported_version_code must be >= 1';
  END IF;
  IF COALESCE(_min_supported_version_code, (_before->>'min_supported_version_code')::int)
     > COALESCE(_latest_version_code, (_before->>'latest_version_code')::int) THEN
    RAISE EXCEPTION 'min_supported_version_code cannot exceed latest_version_code';
  END IF;
  IF _current_version IS NOT NULL AND _current_version !~ '^[0-9]+(\.[0-9]+){0,3}$' THEN
    RAISE EXCEPTION 'current_version must look like 1.2.3';
  END IF;
  IF _min_supported_version IS NOT NULL AND _min_supported_version !~ '^[0-9]+(\.[0-9]+){0,3}$' THEN
    RAISE EXCEPTION 'min_supported_version must look like 1.2.3';
  END IF;

  UPDATE public.app_config SET
    current_version = COALESCE(_current_version, current_version),
    min_supported_version = COALESCE(_min_supported_version, min_supported_version),
    latest_version_code = COALESCE(_latest_version_code, latest_version_code),
    min_supported_version_code = COALESCE(_min_supported_version_code, min_supported_version_code),
    play_store_url = COALESCE(_play_store_url, play_store_url),
    updated_at = now()
  WHERE id = 1;

  SELECT to_jsonb(c) INTO _after FROM public.app_config c WHERE id = 1;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (auth.uid(), 'update_app_versions', 'app_config', NULL, _before, _after);

  RETURN _after;
END $$;

REVOKE EXECUTE ON FUNCTION public.staff_set_app_versions(text, text, int, int, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.staff_set_app_versions(text, text, int, int, text) TO authenticated, service_role;