-- 1. Account deletion (soft delete + anonymise; financial history retained)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE OR REPLACE FUNCTION public.customer_delete_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  UPDATE public.users
     SET full_name = 'Deleted user',
         email = NULL,
         phone = NULL,
         avatar_url = NULL,
         pin_hash = NULL,
         referral_code = NULL,
         referred_by = NULL,
         deleted_at = now(),
         updated_at = now()
   WHERE id = _uid;

  UPDATE public.addresses
     SET label = NULL,
         full_address = 'Removed',
         landmark_photo_url = NULL
   WHERE user_id = _uid;

  DELETE FROM public.device_tokens WHERE user_type = 'customer' AND user_id = _uid;
  DELETE FROM public.device_sessions WHERE user_type = 'customer' AND user_id = _uid;

  BEGIN
    UPDATE auth.users
       SET phone = NULL,
           email = NULL,
           banned_until = 'infinity'::timestamptz
     WHERE id = _uid;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[customer_delete_account] auth cleanup failed for %: %', _uid, SQLERRM;
  END;

  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, after_state)
  VALUES (_uid, 'customer_account_deleted', 'users', _uid, jsonb_build_object('deleted_at', now()));
END $$;

REVOKE ALL ON FUNCTION public.customer_delete_account() FROM public;
GRANT EXECUTE ON FUNCTION public.customer_delete_account() TO authenticated;

-- 2. Customer push notifications on booking status changes
CREATE OR REPLACE FUNCTION public.notify_customer_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _title text; _body text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  IF NEW.status = 'expert_assigned' THEN
    _title := 'Expert assigned';
    _body  := 'Your expert is on the way for ' || COALESCE(NEW.service_label, 'your booking') || '.';
  ELSIF NEW.status = 'in_progress' THEN
    _title := 'Service started';
    _body  := 'Your expert has started the service.';
  ELSIF NEW.status = 'completed' THEN
    _title := 'Service completed';
    _body  := 'Your service is complete. Tap to rate your experience.';
  ELSIF NEW.status = 'cancelled' THEN
    _title := 'Booking cancelled';
    _body  := COALESCE(NEW.cancellation_reason, 'Your booking has been cancelled.');
  ELSIF NEW.status = 'accepted' THEN
    _title := 'Booking confirmed';
    _body  := 'We are finding an expert for you.';
  ELSE
    RETURN NEW;
  END IF;

  PERFORM public.notify_customer_alert(
    NEW.id,
    'booking_' || NEW.status,
    _title,
    _body,
    jsonb_build_object('route', 'my-bookings', 'status', NEW.status)
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_customer_status_change ON public.bookings;
CREATE TRIGGER trg_notify_customer_status_change
AFTER UPDATE OF status ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.notify_customer_status_change();

-- 3. Notify the customer when their support ticket is resolved
CREATE OR REPLACE FUNCTION public.staff_update_support_ticket(_ticket_id uuid, _status text, _note text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid(); _staff_id uuid; _before jsonb; _customer uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _status NOT IN ('open','in_progress','resolved') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  SELECT id INTO _staff_id FROM public.staff_users WHERE auth_user_id = _uid;

  SELECT to_jsonb(t), t.user_id INTO _before, _customer FROM public.support_tickets t WHERE t.id = _ticket_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Ticket not found'; END IF;

  UPDATE public.support_tickets
     SET status = _status,
         internal_note = COALESCE(_note, internal_note),
         resolved_at = CASE WHEN _status = 'resolved' THEN COALESCE(resolved_at, now()) ELSE NULL END,
         resolved_by = CASE WHEN _status = 'resolved' THEN _staff_id ELSE NULL END,
         updated_at = now()
   WHERE id = _ticket_id;

  IF _status = 'resolved' AND _customer IS NOT NULL
     AND COALESCE(_before->>'status','') <> 'resolved' THEN
    PERFORM public.notify_push_event(
      'customer', _customer, 'ticket_resolved',
      'Support request resolved',
      COALESCE(NULLIF(_note, ''), 'Your support request has been resolved.'),
      jsonb_build_object('route', 'help', 'ticket_id', _ticket_id)
    );
  END IF;

  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES(_uid, 'update_support_ticket', 'support_tickets', _ticket_id, _before,
         jsonb_build_object('status', _status, 'internal_note', _note));
END $$;

-- 4. Live expert location for the customer's own active booking
CREATE OR REPLACE FUNCTION public.get_assigned_expert_location(_booking_id uuid)
RETURNS TABLE(expert_id uuid, name text, latitude numeric, longitude numeric, location_updated_at timestamptz, is_online boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT e.id, e.name, e.current_lat, e.current_lng, e.location_updated_at, e.is_online
    FROM public.bookings b
    JOIN public.experts e ON e.id = b.assigned_expert_id
   WHERE b.id = _booking_id
     AND b.user_id = auth.uid()
     AND b.status IN ('expert_assigned','in_progress');
$$;

REVOKE ALL ON FUNCTION public.get_assigned_expert_location(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_assigned_expert_location(uuid) TO authenticated;