-- 1. Revoke execute on trigger functions + system/internal helpers from client roles
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND (
        p.prorettype = 'trigger'::regtype
        OR p.proname LIKE 'system\_%'
        OR p.proname IN (
          'raise_dispatch_alert','evaluate_zone_capacity','check_booking_capacity',
          'send_scheduled_booking_reminders','broadcast_booking_to_experts',
          'expand_stale_broadcasts','expire_stale_online_experts','notify_waitlist_for_expert',
          'credit_referral_for_booking','evaluate_reward_triggers','notify_push_event',
          'notify_customer_push','notify_expert_push','notify_customer_alert',
          'notify_expert_alert','notify_expert_broadcast','notify_customer_user_push',
          'get_auth_user_id_by_email','get_auth_user_id_by_phone','get_customer_auth_id_by_phone',
          'reactivate_customer_after_otp','generate_offline_invoice_number'
        )
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

-- 2. Staff-only RPCs: keep signed-in staff access (functions check is_active_staff), drop anonymous access
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef AND p.proname LIKE 'staff\_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END $$;

-- 3. Booking-scoped lookups should require a session
REVOKE ALL ON FUNCTION public.get_assigned_expert_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_assigned_expert_profile(uuid) TO authenticated, service_role;

-- 4. availability_overrides: catalogue rows stay public, expert/merchant schedules do not
DROP POLICY IF EXISTS "Anyone can read availability overrides" ON public.availability_overrides;

CREATE POLICY "Catalogue availability is readable"
ON public.availability_overrides
FOR SELECT
TO anon, authenticated
USING (target_type IN ('category', 'item'));

CREATE POLICY "Staff can read all availability overrides"
ON public.availability_overrides
FOR SELECT
TO authenticated
USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager','dispatcher','support']));

-- 5. Explicit deny-by-default on server-only tables
CREATE POLICY "No client access" ON public.otp_codes FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "No client access" ON public.otp_rate_limits FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "No client access" ON public.pin_login_lockouts FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "No client access" ON public.edge_runtime_config FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);