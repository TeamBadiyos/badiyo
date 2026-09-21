
-- 1. Central, idempotent completion credit
CREATE OR REPLACE FUNCTION public.credit_booking_completion(_booking_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _b record; _payout numeric; _reason text;
BEGIN
  SELECT id, assigned_expert_id, status, user_id, price, service_duration_minutes,
         snapshot_expert_payout
    INTO _b
    FROM public.bookings WHERE id = _booking_id;
  IF _b.id IS NULL OR _b.status <> 'completed' THEN RETURN 0; END IF;
  IF _b.assigned_expert_id IS NULL THEN RETURN 0; END IF;

  BEGIN
    SELECT r.expert_payout INTO _payout FROM public.resolve_booking_payouts(_booking_id) r;
  EXCEPTION WHEN OTHERS THEN
    _payout := NULL;
  END;
  _payout := COALESCE(_payout, _b.snapshot_expert_payout, 0);

  UPDATE public.experts SET is_busy = false WHERE id = _b.assigned_expert_id;

  _reason := 'Booking payout: ' || _booking_id::text;

  IF _payout > 0 AND NOT EXISTS (
      SELECT 1 FROM public.wallet_ledger
       WHERE owner_type = 'expert' AND owner_id = _b.assigned_expert_id AND reason = _reason) THEN
    INSERT INTO public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by)
    VALUES('expert', _b.assigned_expert_id, _payout, 'credit', _reason, NULL);
    UPDATE public.experts
       SET wallet_balance = COALESCE(wallet_balance,0) + _payout
     WHERE id = _b.assigned_expert_id;

    BEGIN
      PERFORM public.evaluate_reward_triggers('partner', _b.assigned_expert_id, 'booking_completed',
        _booking_id::text,
        jsonb_build_object('booking_id', _booking_id, 'amount', COALESCE(_b.price,0),
                           'minutes', COALESCE(_b.service_duration_minutes,0)));
    EXCEPTION WHEN OTHERS THEN NULL; END;
    IF _b.user_id IS NOT NULL THEN
      BEGIN
        PERFORM public.evaluate_reward_triggers('customer', _b.user_id, 'booking_completed',
          _booking_id::text,
          jsonb_build_object('booking_id', _booking_id, 'amount', COALESCE(_b.price,0)));
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;

    BEGIN
      PERFORM public.notify_expert_alert(
        _b.assigned_expert_id, 'order_completed', 'Job completed',
        'You completed the job. Rs ' || _payout::text || ' has been credited to your wallet.',
        jsonb_build_object('booking_id', _booking_id, 'route', 'booking/' || _booking_id::text));
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  RETURN _payout;
END;
$$;

REVOKE ALL ON FUNCTION public.credit_booking_completion(uuid) FROM public, anon, authenticated;

-- 2. Stamp end time / updated_at on completion (BEFORE UPDATE, runs after the guard trigger)
CREATE OR REPLACE FUNCTION public.bookings_stamp_completion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.updated_at := now();
    IF NEW.status = 'completed' AND NEW.service_end_at IS NULL THEN
      NEW.service_end_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_zz_bookings_stamp_completion ON public.bookings;
CREATE TRIGGER trg_zz_bookings_stamp_completion
BEFORE UPDATE OF status ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.bookings_stamp_completion();

-- 3. Credit on every completion path
CREATE OR REPLACE FUNCTION public.bookings_after_complete_payout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed' AND COALESCE(OLD.status,'') <> 'completed' THEN
    PERFORM public.credit_booking_completion(NEW.id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_zz_bookings_after_complete_payout ON public.bookings;
CREATE TRIGGER trg_zz_bookings_after_complete_payout
AFTER UPDATE OF status ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.bookings_after_complete_payout();

-- 4. Backfill missing payouts for already-completed bookings
DO $$
DECLARE _r record; _payout numeric; _reason text;
BEGIN
  FOR _r IN
    SELECT b.id, b.assigned_expert_id, COALESCE(b.snapshot_expert_payout,0) AS payout
      FROM public.bookings b
     WHERE b.status = 'completed'
       AND b.assigned_expert_id IS NOT NULL
       AND b.deleted_at IS NULL
       AND COALESCE(b.snapshot_expert_payout,0) > 0
       AND NOT EXISTS (
         SELECT 1 FROM public.wallet_ledger w
          WHERE w.owner_type='expert' AND w.owner_id = b.assigned_expert_id
            AND w.reason = 'Booking payout: ' || b.id::text)
  LOOP
    _reason := 'Booking payout: ' || _r.id::text;
    INSERT INTO public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by)
    VALUES('expert', _r.assigned_expert_id, _r.payout, 'credit', _reason, NULL);
    UPDATE public.experts
       SET wallet_balance = COALESCE(wallet_balance,0) + _r.payout
     WHERE id = _r.assigned_expert_id;
  END LOOP;
END $$;
