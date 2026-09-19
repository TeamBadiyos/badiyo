
-- M1: admin alert queue + log + settings + job secret

CREATE TABLE public.admin_alert_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_type text NOT NULL,
  order_id uuid NOT NULL,
  v_order text NOT NULL DEFAULT '',
  v_customer text NOT NULL DEFAULT 'Customer',
  v_amount text NOT NULL DEFAULT '0',
  v_time text NOT NULL DEFAULT 'Now',
  status text NOT NULL DEFAULT 'pending',
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_alert_queue_unique_order UNIQUE (order_type, order_id)
);

CREATE INDEX admin_alert_queue_pending_idx
  ON public.admin_alert_queue (next_attempt_at)
  WHERE status = 'pending';

CREATE TABLE public.admin_alert_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_type text NOT NULL,
  order_id uuid NOT NULL,
  status text NOT NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX admin_alert_log_created_idx ON public.admin_alert_log (created_at DESC);

-- Grants: no anon, no authenticated writes. Super admins read via policy.
GRANT SELECT ON public.admin_alert_queue TO authenticated;
GRANT SELECT ON public.admin_alert_log TO authenticated;
GRANT ALL ON public.admin_alert_queue TO service_role;
GRANT ALL ON public.admin_alert_log TO service_role;

ALTER TABLE public.admin_alert_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_alert_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins read alert queue"
  ON public.admin_alert_queue FOR SELECT TO authenticated
  USING (public.is_super_admin_user());

CREATE POLICY "Super admins read alert log"
  ON public.admin_alert_log FOR SELECT TO authenticated
  USING (public.is_super_admin_user());

-- Settings (off by default)
INSERT INTO public.ops_settings (key, value, label)
VALUES
  ('admin_whatsapp_alert_enabled', '0', 'Admin WhatsApp alert on new paid order (1 = on)'),
  ('admin_whatsapp_alert_merchant_enabled', '0', 'Admin WhatsApp alert for merchant orders (1 = on)')
ON CONFLICT (key) DO NOTHING;

-- Only super_admin may change these two keys (ops_manager can edit other keys).
CREATE OR REPLACE FUNCTION public.admin_alert_settings_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.key IN ('admin_whatsapp_alert_enabled', 'admin_whatsapp_alert_merchant_enabled')
     AND auth.uid() IS NOT NULL
     AND NOT public.is_super_admin_user() THEN
    RAISE EXCEPTION 'Only a super admin can change %', NEW.key;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_alert_settings_guard() FROM anon, public;

CREATE TRIGGER admin_alert_settings_guard_trg
  BEFORE UPDATE ON public.ops_settings
  FOR EACH ROW EXECUTE FUNCTION public.admin_alert_settings_guard();

-- Random shared secret for the processing route (never hardcoded).
DO $$
DECLARE _exists boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'admin_alert_job_secret') INTO _exists;
  IF NOT _exists THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'admin_alert_job_secret', 'Shared secret for the admin WhatsApp alert worker route');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.admin_alert_verify_job_secret(_secret text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE _stored text;
BEGIN
  SELECT decrypted_secret INTO _stored FROM vault.decrypted_secrets WHERE name = 'admin_alert_job_secret';
  IF _stored IS NULL OR _secret IS NULL THEN RETURN false; END IF;
  RETURN _stored = _secret;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_alert_verify_job_secret(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_alert_verify_job_secret(text) TO service_role;
