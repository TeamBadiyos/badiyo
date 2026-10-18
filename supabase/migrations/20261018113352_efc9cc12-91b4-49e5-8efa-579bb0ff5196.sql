INSERT INTO public.ops_settings (key, value, label) VALUES
 ('otp_ip_limit_per_hour','300','Login OTP: max sends per network (IP) per hour'),
 ('otp_event_ip_limit_per_hour','2000','Login OTP: per-network limit per hour during event mode'),
 ('otp_event_mode_start','','Login OTP: event mode start (ISO date-time, e.g. 2026-10-20T16:00+05:30)'),
 ('otp_event_mode_end','','Login OTP: event mode end (ISO date-time)'),
 ('otp_global_cap_per_hour','3000','Login OTP: global safety cap per hour (alerts Command Center)')
ON CONFLICT (key) DO NOTHING;

CREATE INDEX IF NOT EXISTS otp_rate_limits_created_idx ON public.otp_rate_limits (created_at DESC);

CREATE OR REPLACE FUNCTION public.otp_global_cap_alert(_count integer, _cap integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.staff_notifications (notif_key, kind, title, detail, target)
  VALUES ('otp_global_cap_' || to_char(now() AT TIME ZONE 'Asia/Kolkata','YYYYMMDDHH24'),
          'otp_global_cap', 'Login OTP safety cap reached',
          format('%s login codes sent in the last hour (cap %s). New sends are being blocked.', _count, _cap),
          'dashboard')
  ON CONFLICT (notif_key) DO UPDATE SET detail = EXCLUDED.detail, event_at = now(), read_at = NULL, dismissed_at = NULL;
END $$;
REVOKE ALL ON FUNCTION public.otp_global_cap_alert(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.otp_global_cap_alert(integer, integer) TO service_role;