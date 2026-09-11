-- 1) Allow rating after completion
CREATE OR REPLACE FUNCTION public.submit_booking_review(_booking_id uuid, _rating integer, _review text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _current text; _owner uuid; _r int; _expert uuid; _price numeric; _existing_rating int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT status, user_id, assigned_expert_id, price, rating
    INTO _current, _owner, _expert, _price, _existing_rating FROM public.bookings WHERE id = _booking_id;
  IF _owner IS NULL OR _owner <> _uid THEN RAISE EXCEPTION 'Not found'; END IF;
  IF _current NOT IN ('in_progress','completed') THEN RAISE EXCEPTION 'Invalid status transition'; END IF;
  _r := NULLIF(_rating, 0);
  IF _r IS NOT NULL AND (_r < 1 OR _r > 5) THEN RAISE EXCEPTION 'Invalid rating'; END IF;

  PERFORM set_config('app.booking_bypass', 'on', true);
  IF _current = 'in_progress' THEN
    UPDATE public.bookings
       SET status='completed', rating=_r, review_text=NULLIF(btrim(coalesce(_review,'')),'')
     WHERE id = _booking_id;
  ELSE
    -- already completed: store rating/review only
    UPDATE public.bookings
       SET rating = COALESCE(_r, rating),
           review_text = COALESCE(NULLIF(btrim(coalesce(_review,'')),''), review_text),
           updated_at = now()
     WHERE id = _booking_id;
  END IF;
  PERFORM set_config('app.booking_bypass', 'off', true);

  PERFORM public.evaluate_reward_triggers('customer', _owner, 'booking_completed', _booking_id::text,
    jsonb_build_object('booking_id', _booking_id, 'amount', COALESCE(_price,0)));
  IF _expert IS NOT NULL THEN
    PERFORM public.evaluate_reward_triggers('partner', _expert, 'booking_completed', _booking_id::text,
      jsonb_build_object('booking_id', _booking_id, 'amount', COALESCE(_price,0)));
  END IF;
  IF _r IS NOT NULL AND _existing_rating IS NULL THEN
    PERFORM public.evaluate_reward_triggers('customer', _owner, 'rating_given', _booking_id::text,
      jsonb_build_object('booking_id', _booking_id, 'rating', _r));
    IF _expert IS NOT NULL THEN
      PERFORM public.evaluate_reward_triggers('partner', _expert, 'rating_given', _booking_id::text,
        jsonb_build_object('booking_id', _booking_id, 'rating', _r));
    END IF;
  END IF;
END;$function$;

-- 2) Keep cash and coins separate for customers
CREATE OR REPLACE FUNCTION public.reward_apply_credit(_program reward_programs, _actor_type text, _actor_id uuid, _event_ref text, _notes text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _inserted uuid; _label text; _body text;
BEGIN
  INSERT INTO public.reward_ledger(program_id, program_name, actor_type, actor_id, trigger_event_ref,
                                   reward_type, reward_value, status, notes)
  VALUES (_program.id, _program.name, _actor_type, _actor_id, _event_ref,
          _program.reward_type, COALESCE(_program.reward_value,0), 'credited', _notes)
  ON CONFLICT (program_id, actor_id, trigger_event_ref) DO NOTHING
  RETURNING id INTO _inserted;

  IF _inserted IS NULL THEN RETURN false; END IF;

  IF COALESCE(_program.reward_value,0) > 0 THEN
    IF _actor_type = 'customer' AND _program.reward_type = 'coins' THEN
      PERFORM set_config('app.users_bypass','on', true);
      UPDATE public.users
         SET total_coins_earned = COALESCE(total_coins_earned,0) + _program.reward_value::int
       WHERE id = _actor_id;
      PERFORM set_config('app.users_bypass','off', true);
    ELSIF _actor_type = 'customer' AND _program.reward_type IN ('cash','wallet_credit') THEN
      INSERT INTO public.wallet_transactions(user_id, amount, type, description)
      VALUES (_actor_id, _program.reward_value, 'credit', 'Reward: ' || _program.name);
    ELSIF _actor_type = 'partner' AND _program.reward_type = 'cash' THEN
      INSERT INTO public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by)
      VALUES ('expert', _actor_id, _program.reward_value, 'credit', 'Reward: ' || _program.name, NULL);
      UPDATE public.experts
         SET wallet_balance = COALESCE(wallet_balance,0) + _program.reward_value
       WHERE id = _actor_id;
    ELSIF _actor_type = 'merchant' AND _program.reward_type = 'cash' THEN
      INSERT INTO public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by)
      VALUES ('merchant', _actor_id, _program.reward_value, 'credit', 'Reward: ' || _program.name, NULL);
    END IF;

    _label := CASE WHEN _program.reward_type = 'coins'
                THEN COALESCE(_program.reward_value,0)::text || ' coins'
                ELSE '₹' || COALESCE(_program.reward_value,0)::text END;
    _body := 'You earned ' || _label || ' — ' || _program.name || '.';

    IF _actor_type = 'customer' THEN
      PERFORM public.notify_push_event('customer', _actor_id, 'reward_credited',
        'Reward credited', _body, jsonb_build_object('route','rewards'));
    ELSIF _actor_type = 'partner' THEN
      PERFORM public.notify_push_event('expert', _actor_id, 'reward_credited',
        'Reward credited', _body, jsonb_build_object('route','earnings'));
    END IF;
  END IF;

  RETURN true;
END;
$function$;

-- 3) Reverse the money back when a reward is reversed
CREATE OR REPLACE FUNCTION public.reward_ledger_after_reversal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _v numeric := COALESCE(NEW.reward_value, 0);
BEGIN
  IF NEW.status = 'reversed' AND COALESCE(OLD.status,'') <> 'reversed' AND _v > 0 THEN
    IF NEW.actor_type = 'customer' AND NEW.reward_type = 'coins' THEN
      PERFORM set_config('app.users_bypass','on', true);
      UPDATE public.users
         SET total_coins_earned = GREATEST(COALESCE(total_coins_earned,0) - _v::int, 0)
       WHERE id = NEW.actor_id;
      PERFORM set_config('app.users_bypass','off', true);
    ELSIF NEW.actor_type = 'customer' AND NEW.reward_type IN ('cash','wallet_credit') THEN
      INSERT INTO public.wallet_transactions(user_id, amount, type, description)
      VALUES (NEW.actor_id, _v, 'debit', 'Reward reversed: ' || COALESCE(NEW.program_name,'reward'));
    ELSIF NEW.actor_type = 'partner' AND NEW.reward_type = 'cash' THEN
      INSERT INTO public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by)
      VALUES ('expert', NEW.actor_id, _v, 'debit', 'Reward reversed: ' || COALESCE(NEW.program_name,'reward'), NULL);
      UPDATE public.experts
         SET wallet_balance = GREATEST(COALESCE(wallet_balance,0) - _v, 0)
       WHERE id = NEW.actor_id;
    ELSIF NEW.actor_type = 'merchant' AND NEW.reward_type = 'cash' THEN
      INSERT INTO public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by)
      VALUES ('merchant', NEW.actor_id, _v, 'debit', 'Reward reversed: ' || COALESCE(NEW.program_name,'reward'), NULL);
    END IF;
  END IF;
  RETURN NULL;
END $function$;

DROP TRIGGER IF EXISTS trg_reward_ledger_after_reversal ON public.reward_ledger;
CREATE TRIGGER trg_reward_ledger_after_reversal
AFTER UPDATE OF status ON public.reward_ledger
FOR EACH ROW EXECUTE FUNCTION public.reward_ledger_after_reversal();

-- 4) Customer period targets use actual service end time
CREATE OR REPLACE FUNCTION public.run_reward_period_jobs(_force_period_start date DEFAULT NULL::date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _p public.reward_programs;
  _period text;
  _start timestamptz;
  _end timestamptz;
  _ref text;
  _granted integer := 0;
  _actor record;
  _threshold numeric;
BEGIN
  FOR _p IN
    SELECT rp.* FROM public.reward_programs rp
     JOIN public.reward_trigger_types tt ON tt.key = rp.trigger_type
     WHERE rp.is_active = true AND tt.is_time_based = true
       AND (rp.valid_from IS NULL OR rp.valid_from <= now())
       AND (rp.valid_until IS NULL OR rp.valid_until >= now())
  LOOP
    _period := COALESCE(_p.condition->>'period', 'weekly');

    IF _force_period_start IS NOT NULL THEN
      _start := _force_period_start::timestamptz;
      _end := CASE WHEN _period = 'monthly' THEN _start + interval '1 month' ELSE _start + interval '7 days' END;
    ELSIF _period = 'monthly' THEN
      _start := date_trunc('month', now()) - interval '1 month';
      _end := date_trunc('month', now());
    ELSE
      _start := date_trunc('week', now()) - interval '7 days';
      _end := date_trunc('week', now());
    END IF;

    _ref := _p.trigger_type || ':' || _period || ':' || to_char(_start, 'YYYY-MM-DD');

    IF _p.trigger_type = 'hours_threshold' THEN
      _threshold := COALESCE((_p.condition->>'hours')::numeric, 0);
      IF _p.actor_type = 'partner' THEN
        FOR _actor IN
          SELECT b.assigned_expert_id AS id,
                 SUM(COALESCE(b.service_duration_minutes,0))::numeric / 60.0 AS metric
            FROM public.bookings b
           WHERE b.status = 'completed' AND b.assigned_expert_id IS NOT NULL
             AND b.service_end_at >= _start AND b.service_end_at < _end
           GROUP BY b.assigned_expert_id
        LOOP
          IF _actor.metric >= _threshold AND public.reward_apply_credit(
               _p, _p.actor_type, _actor.id, _ref,
               'Hours in period: ' || round(_actor.metric, 2)::text) THEN
            _granted := _granted + 1;
          END IF;
        END LOOP;
      END IF;

    ELSIF _p.trigger_type = 'count_threshold' THEN
      _threshold := COALESCE((_p.condition->>'count')::numeric, 0);

      IF _p.actor_type = 'partner' THEN
        FOR _actor IN
          SELECT b.assigned_expert_id AS id, count(*)::numeric AS metric
            FROM public.bookings b
           WHERE b.status = 'completed' AND b.assigned_expert_id IS NOT NULL
             AND b.service_end_at >= _start AND b.service_end_at < _end
           GROUP BY b.assigned_expert_id
        LOOP
          IF _actor.metric >= _threshold AND public.reward_apply_credit(
               _p, _p.actor_type, _actor.id, _ref, 'Count in period: ' || _actor.metric::text) THEN
            _granted := _granted + 1;
          END IF;
        END LOOP;

      ELSIF _p.actor_type = 'customer' THEN
        FOR _actor IN
          SELECT b.user_id AS id, count(*)::numeric AS metric
            FROM public.bookings b
           WHERE b.status = 'completed' AND b.user_id IS NOT NULL
             AND COALESCE(b.service_end_at, b.updated_at) >= _start
             AND COALESCE(b.service_end_at, b.updated_at) < _end
           GROUP BY b.user_id
        LOOP
          IF _actor.metric >= _threshold AND public.reward_apply_credit(
               _p, _p.actor_type, _actor.id, _ref, 'Count in period: ' || _actor.metric::text) THEN
            _granted := _granted + 1;
          END IF;
        END LOOP;

      ELSIF _p.actor_type = 'merchant' THEN
        FOR _actor IN
          SELECT o.merchant_id AS id, count(*)::numeric AS metric
            FROM public.merchant_orders o
           WHERE o.status = 'completed'
             AND o.updated_at >= _start AND o.updated_at < _end
           GROUP BY o.merchant_id
        LOOP
          IF _actor.metric >= _threshold AND public.reward_apply_credit(
               _p, _p.actor_type, _actor.id, _ref, 'Count in period: ' || _actor.metric::text) THEN
            _granted := _granted + 1;
          END IF;
        END LOOP;
      END IF;
    END IF;
  END LOOP;

  RETURN _granted;
END $function$;