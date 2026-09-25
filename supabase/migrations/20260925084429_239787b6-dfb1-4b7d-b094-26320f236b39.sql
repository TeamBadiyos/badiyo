-- 1. wallet_type on the shared ledger -------------------------------------
alter table public.wallet_ledger
  add column if not exists wallet_type text not null default 'earnings';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'wallet_ledger_wallet_type_check') then
    alter table public.wallet_ledger
      add constraint wallet_ledger_wallet_type_check
      check (wallet_type in ('earnings','delivery'));
  end if;
end $$;

update public.wallet_ledger set wallet_type = 'earnings' where wallet_type is null;

create index if not exists wallet_ledger_owner_wallet_idx
  on public.wallet_ledger (owner_type, owner_id, wallet_type, created_at desc);

-- 2. delivery wallet balance on merchants ----------------------------------
alter table public.merchants
  add column if not exists delivery_wallet_balance numeric not null default 0;

CREATE OR REPLACE FUNCTION public.merchants_guard_privileged()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_col text;
BEGIN
  IF current_user NOT IN ('authenticated','anon') OR coalesce(auth.role(),'') = 'service_role' THEN RETURN NEW; END IF;
  IF public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RETURN NEW; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN v_col := 'status';
  ELSIF NEW.commission_type IS DISTINCT FROM OLD.commission_type THEN v_col := 'commission_type';
  ELSIF NEW.commission_value IS DISTINCT FROM OLD.commission_value THEN v_col := 'commission_value';
  ELSIF NEW.fee_tier_id IS DISTINCT FROM OLD.fee_tier_id THEN v_col := 'fee_tier_id';
  ELSIF NEW.zone_id IS DISTINCT FROM OLD.zone_id THEN v_col := 'zone_id';
  ELSIF NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN v_col := 'approved_at';
  ELSIF NEW.approved_by IS DISTINCT FROM OLD.approved_by THEN v_col := 'approved_by';
  ELSIF NEW.onboarded_by IS DISTINCT FROM OLD.onboarded_by THEN v_col := 'onboarded_by';
  ELSIF NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id THEN v_col := 'auth_user_id';
  ELSIF NEW.phone IS DISTINCT FROM OLD.phone THEN v_col := 'phone';
  ELSIF NEW.pin_hash IS DISTINCT FROM OLD.pin_hash THEN v_col := 'pin_hash';
  ELSIF NEW.store_enabled IS DISTINCT FROM OLD.store_enabled THEN v_col := 'store_enabled';
  ELSIF NEW.delivery_enabled IS DISTINCT FROM OLD.delivery_enabled THEN v_col := 'delivery_enabled';
  ELSIF NEW.delivery_status IS DISTINCT FROM OLD.delivery_status THEN v_col := 'delivery_status';
  ELSIF NEW.delivery_wallet_balance IS DISTINCT FROM OLD.delivery_wallet_balance THEN v_col := 'delivery_wallet_balance';
  ELSIF NEW.gst_status IS DISTINCT FROM OLD.gst_status AND OLD.status NOT IN ('draft','rejected') THEN v_col := 'gst_status';
  ELSIF (NEW.store_category_id IS DISTINCT FROM OLD.store_category_id OR NEW.segment_id IS DISTINCT FROM OLD.segment_id)
        AND OLD.status NOT IN ('draft','pending_review','rejected') THEN v_col := 'store_category_id';
  END IF;
  IF v_col IS NOT NULL THEN
    RAISE EXCEPTION 'Not allowed to change % on merchant profile', v_col USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $function$;

-- 3. earnings-only scoping for every merchant ledger reader/writer ---------
CREATE OR REPLACE FUNCTION public.staff_generate_merchant_payout_batch()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _batch_id uuid;
  _ws date;
  _we date;
  _total numeric := 0;
  _used_ledger uuid[];
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  _ws := date_trunc('week', now())::date;
  _we := (_ws + INTERVAL '6 days')::date;

  IF EXISTS (SELECT 1 FROM public.payout_batches WHERE week_start=_ws AND batch_type='merchant') THEN
    RAISE EXCEPTION 'Merchant batch already exists for this week';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT l), ARRAY[]::uuid[])
    INTO _used_ledger
    FROM public.payout_batch_items p, unnest(p.ledger_ids) AS l;

  INSERT INTO public.payout_batches(week_start, week_end, status, total_amount, batch_type)
    VALUES(_ws, _we, 'pending', 0, 'merchant')
    RETURNING id INTO _batch_id;

  WITH cand AS (
    SELECT wl.id AS ledger_id, wl.owner_id,
           CASE WHEN wl.type = 'credit' THEN wl.amount ELSE -wl.amount END AS delta
      FROM public.wallet_ledger wl
     WHERE wl.owner_type = 'merchant'
       AND wl.wallet_type = 'earnings'
       AND wl.created_at::date BETWEEN _ws AND _we
       AND NOT (wl.id = ANY(_used_ledger))
  ), agg AS (
    SELECT owner_id, SUM(delta) AS amount, array_agg(ledger_id) AS ledger_ids
      FROM cand GROUP BY owner_id
  )
  INSERT INTO public.payout_batch_items(batch_id, owner_type, owner_id, amount, booking_ids, ledger_ids)
    SELECT _batch_id, 'merchant', owner_id, amount, ARRAY[]::uuid[], ledger_ids
      FROM agg WHERE amount > 0;

  SELECT COALESCE(SUM(amount),0) INTO _total FROM public.payout_batch_items WHERE batch_id=_batch_id;
  UPDATE public.payout_batches SET total_amount=_total WHERE id=_batch_id;

  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
    VALUES(_uid,'generate_merchant_payout_batch','payout_batches',_batch_id,NULL,
           jsonb_build_object('week_start',_ws,'week_end',_we,'total_amount',_total,'batch_type','merchant'));

  RETURN _batch_id;
END $function$;

CREATE OR REPLACE FUNCTION public.staff_confirm_payout_batch(_batch_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _before jsonb; _it record;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  SELECT to_jsonb(b) INTO _before FROM public.payout_batches b WHERE b.id=_batch_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Batch not found'; END IF;
  IF (_before->>'status') = 'paid' THEN RETURN; END IF;
  IF (_before->>'status') = 'discarded' THEN RAISE EXCEPTION 'Batch was discarded'; END IF;

  IF public.get_ops_flag('payout_batch_wallet_mode') THEN
    FOR _it IN SELECT * FROM public.payout_batch_items WHERE batch_id=_batch_id AND NOT paid LOOP
      INSERT INTO public.wallet_ledger(owner_type, owner_id, type, amount, reason, wallet_type)
      VALUES(_it.owner_type, _it.owner_id, 'debit', _it.gross_amount,
             'Payout batch settled (gross): ' || _batch_id, 'earnings');
      IF COALESCE(_it.tds_amount,0) > 0 THEN
        INSERT INTO public.wallet_ledger(owner_type, owner_id, type, amount, reason, wallet_type)
        VALUES(_it.owner_type, _it.owner_id, 'credit', _it.tds_amount,
               'TDS withheld @' || _it.tds_rate || '% for batch ' || _batch_id, 'earnings');
      END IF;
      IF _it.owner_type='expert' THEN
        UPDATE public.experts
           SET wallet_balance = COALESCE(wallet_balance,0) - _it.gross_amount + COALESCE(_it.tds_amount,0)
         WHERE id=_it.owner_id;
      END IF;
    END LOOP;
  END IF;

  UPDATE public.payout_batch_items SET paid=true, paid_at=now() WHERE batch_id=_batch_id;
  UPDATE public.payout_batches SET status='paid' WHERE id=_batch_id;

  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES(_uid,'confirm_payout_batch','payout_batches',_batch_id,_before,
         jsonb_build_object('status','paid','wallet_mode',public.get_ops_flag('payout_batch_wallet_mode')));
END $function$;

CREATE OR REPLACE FUNCTION public.staff_discard_payout_batch(_batch_id uuid, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _before jsonb; _it record;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_super_admin_user() THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT to_jsonb(b) INTO _before FROM public.payout_batches b WHERE b.id=_batch_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Batch not found'; END IF;
  IF (_before->>'status') = 'paid' THEN RAISE EXCEPTION 'Paid batch cannot be discarded'; END IF;

  UPDATE public.bookings SET expert_payout_batch_id = NULL WHERE expert_payout_batch_id = _batch_id;
  UPDATE public.bookings SET partner_payout_batch_id = NULL WHERE partner_payout_batch_id = _batch_id;

  FOR _it IN SELECT * FROM public.payout_batch_items WHERE batch_id=_batch_id AND paid LOOP
    INSERT INTO public.wallet_ledger(owner_type, owner_id, type, amount, reason, wallet_type)
    VALUES(_it.owner_type, _it.owner_id, 'credit', _it.gross_amount,
           'Payout batch discarded – reversal: ' || _batch_id, 'earnings');
    IF _it.owner_type='expert' THEN
      UPDATE public.experts SET wallet_balance = COALESCE(wallet_balance,0) + _it.gross_amount
       WHERE id=_it.owner_id;
    END IF;
  END LOOP;

  UPDATE public.payout_batch_items
     SET tds_status = CASE WHEN tds_status='accrued' THEN 'cancelled' ELSE tds_status END,
         paid = false, paid_at = NULL
   WHERE batch_id=_batch_id;

  UPDATE public.payout_batches SET status='discarded' WHERE id=_batch_id;

  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES(_uid,'discard_payout_batch','payout_batches',_batch_id,_before,
         jsonb_build_object('status','discarded','reason',_reason));
END $function$;

CREATE OR REPLACE FUNCTION public.merchant_orders_ledger_on_complete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _net numeric;
begin
  if NEW.status in ('completed','delivered') and coalesce(OLD.status,'') not in ('completed','delivered') then
    _net := (case when NEW.courier_order_id is not null then coalesce(NEW.items_total,0) else coalesce(NEW.total_amount,0) end)
            - coalesce(NEW.commission_amount,0);
    insert into public.wallet_ledger (owner_type, owner_id, amount, type, reason, wallet_type)
    values ('merchant', NEW.merchant_id, abs(_net), case when _net < 0 then 'debit' else 'credit' end, 'order:' || NEW.id::text, 'earnings')
    on conflict do nothing;
    begin
      perform public.evaluate_reward_triggers('merchant', NEW.merchant_id, 'order_completed', NEW.id::text,
        jsonb_build_object('order_id', NEW.id, 'amount', coalesce(NEW.total_amount,0)));
    exception when others then raise warning '[merchant order reward] %', sqlerrm;
    end;
  end if;
  return NEW;
end $function$;

CREATE OR REPLACE FUNCTION public.reward_apply_credit(_program reward_programs, _actor_type text, _actor_id uuid, _event_ref text, _notes text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _inserted uuid; _label text; _body text; _period_start timestamptz;
BEGIN
  IF _program.recurrence IN ('weekly','monthly') THEN
    _period_start := CASE WHEN _program.recurrence = 'monthly'
                          THEN date_trunc('month', now())
                          ELSE date_trunc('week', now()) END;
    IF EXISTS (
      SELECT 1 FROM public.reward_ledger
       WHERE program_id = _program.id AND actor_id = _actor_id
         AND status = 'credited' AND credited_at >= _period_start
    ) THEN
      RETURN false;
    END IF;
  END IF;

  INSERT INTO public.reward_ledger(program_id, program_name, actor_type, actor_id, trigger_event_ref,
                                   reward_type, reward_value, status, notes)
  VALUES (_program.id, _program.name, _actor_type, _actor_id, _event_ref,
          _program.reward_type, COALESCE(_program.reward_value,0), 'credited', _notes)
  ON CONFLICT (program_id, actor_id, trigger_event_ref) DO NOTHING
  RETURNING id INTO _inserted;

  IF _inserted IS NULL THEN RETURN false; END IF;

  IF COALESCE(_program.reward_value,0) > 0 THEN
    IF _actor_type = 'customer' AND _program.reward_type IN ('coins','cash') THEN
      PERFORM set_config('app.users_bypass','on', true);
      UPDATE public.users
         SET total_coins_earned = COALESCE(total_coins_earned,0) + _program.reward_value::int
       WHERE id = _actor_id;
      PERFORM set_config('app.users_bypass','off', true);
      INSERT INTO public.wallet_transactions(user_id, amount, type, description)
      VALUES (_actor_id, _program.reward_value, 'credit', 'Reward: ' || _program.name);
    ELSIF _actor_type = 'partner' AND _program.reward_type IN ('cash','coins') THEN
      INSERT INTO public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by, wallet_type)
      VALUES ('expert', _actor_id, _program.reward_value, 'credit', 'Reward: ' || _program.name, NULL, 'earnings');
      UPDATE public.experts
         SET wallet_balance = COALESCE(wallet_balance,0) + _program.reward_value
       WHERE id = _actor_id;
    ELSIF _actor_type = 'merchant' AND _program.reward_type IN ('cash','coins') THEN
      INSERT INTO public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by, wallet_type)
      VALUES ('merchant', _actor_id, _program.reward_value, 'credit', 'Reward: ' || _program.name, NULL, 'earnings');
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
    ELSIF _actor_type = 'merchant' THEN
      PERFORM public.notify_push_event('merchant', _actor_id, 'reward_credited',
        'Reward credited', _body, jsonb_build_object('route','earnings'));
    END IF;
  END IF;

  RETURN true;
END;
$function$;

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
      INSERT INTO public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by, wallet_type)
      VALUES ('expert', NEW.actor_id, _v, 'debit', 'Reward reversed: ' || COALESCE(NEW.program_name,'reward'), NULL, 'earnings');
      UPDATE public.experts
         SET wallet_balance = GREATEST(COALESCE(wallet_balance,0) - _v, 0)
       WHERE id = NEW.actor_id;
    ELSIF NEW.actor_type = 'merchant' AND NEW.reward_type = 'cash' THEN
      INSERT INTO public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by, wallet_type)
      VALUES ('merchant', NEW.actor_id, _v, 'debit', 'Reward reversed: ' || COALESCE(NEW.program_name,'reward'), NULL, 'earnings');
    END IF;
  END IF;
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.staff_reverse_reward(_ledger_id uuid, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _staff uuid; _row public.reward_ledger; _before jsonb; _after jsonb;
BEGIN
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN RAISE EXCEPTION 'Reason required'; END IF;
  SELECT * INTO _row FROM public.reward_ledger WHERE id = _ledger_id;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'Reward not found'; END IF;
  IF _row.status <> 'credited' THEN RAISE EXCEPTION 'Only credited rewards can be reversed'; END IF;
  _before := to_jsonb(_row);
  SELECT id INTO _staff FROM public.staff_users WHERE auth_user_id = _uid;

  UPDATE public.reward_ledger
     SET status = 'reversed', reversed_at = now(), reversed_by = _staff, reversal_reason = btrim(_reason)
   WHERE id = _ledger_id;

  IF COALESCE(_row.reward_value,0) > 0 THEN
    IF _row.actor_type = 'customer' AND _row.reward_type IN ('coins','cash') THEN
      PERFORM set_config('app.users_bypass','on', true);
      UPDATE public.users SET total_coins_earned = GREATEST(COALESCE(total_coins_earned,0) - _row.reward_value::int, 0)
       WHERE id = _row.actor_id;
      PERFORM set_config('app.users_bypass','off', true);
      INSERT INTO public.wallet_transactions(user_id, amount, type, description)
      VALUES (_row.actor_id, _row.reward_value, 'debit', 'Reward reversed: ' || btrim(_reason));
    ELSIF _row.actor_type = 'partner' AND _row.reward_type IN ('cash','coins') THEN
      INSERT INTO public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by, wallet_type)
      VALUES ('expert', _row.actor_id, -_row.reward_value, 'debit', 'Reward reversed: ' || btrim(_reason), _staff, 'earnings');
      UPDATE public.experts SET wallet_balance = COALESCE(wallet_balance,0) - _row.reward_value WHERE id = _row.actor_id;
    ELSIF _row.actor_type = 'merchant' AND _row.reward_type IN ('cash','coins') THEN
      INSERT INTO public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by, wallet_type)
      VALUES ('merchant', _row.actor_id, -_row.reward_value, 'debit', 'Reward reversed: ' || btrim(_reason), _staff, 'earnings');
    END IF;
  END IF;

  SELECT to_jsonb(r) INTO _after FROM public.reward_ledger r WHERE id = _ledger_id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'reverse_reward', 'reward_ledger', _ledger_id, _before, _after);
END $function$;

-- 4. single posting function for the delivery wallet ------------------------
CREATE OR REPLACE FUNCTION public.business_wallet_post(
  _merchant_id uuid,
  _type text,
  _amount numeric,
  _reason text,
  _allow_negative boolean DEFAULT false,
  _created_by uuid DEFAULT NULL
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _bal numeric; _existing uuid; _id uuid; _r text := btrim(coalesce(_reason,''));
begin
  if _merchant_id is null then raise exception 'merchant_id required'; end if;
  if _type not in ('credit','debit') then raise exception 'Invalid type'; end if;
  if _amount is null or _amount <= 0 then raise exception 'Amount must be positive'; end if;
  if _r = '' then raise exception 'Reason required'; end if;

  select delivery_wallet_balance into _bal from public.merchants where id = _merchant_id for update;
  if not found then raise exception 'Business not found'; end if;

  select id into _existing from public.wallet_ledger
   where owner_type='merchant' and owner_id=_merchant_id and wallet_type='delivery' and reason=_r
   limit 1;
  if _existing is not null then return _existing; end if;

  if _type = 'debit' and not _allow_negative and coalesce(_bal,0) - _amount < 0 then
    raise exception 'INSUFFICIENT_WALLET_BALANCE' using errcode='23514';
  end if;

  insert into public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by, wallet_type)
  values ('merchant', _merchant_id, _amount, _type, _r, _created_by, 'delivery')
  returning id into _id;

  update public.merchants
     set delivery_wallet_balance = coalesce(delivery_wallet_balance,0)
         + case when _type='credit' then _amount else -_amount end
   where id = _merchant_id;

  return _id;
end $function$;

REVOKE ALL ON FUNCTION public.business_wallet_post(uuid, text, numeric, text, boolean, uuid) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.business_wallet_post(uuid, text, numeric, text, boolean, uuid) TO service_role;

-- 5. top-up intents ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_wallet_topups (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  amount numeric not null check (amount > 0),
  razorpay_order_id text not null unique,
  razorpay_payment_id text,
  status text not null default 'created' check (status in ('created','paid','failed')),
  created_by_label text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

GRANT SELECT ON public.business_wallet_topups TO authenticated;
GRANT ALL ON public.business_wallet_topups TO service_role;

ALTER TABLE public.business_wallet_topups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "business_wallet_topups read" ON public.business_wallet_topups;
CREATE POLICY "business_wallet_topups read" ON public.business_wallet_topups
  FOR SELECT TO authenticated
  USING (merchant_id = public.current_merchant_id() OR public.courier_is_ops_staff());

CREATE INDEX IF NOT EXISTS business_wallet_topups_merchant_idx
  ON public.business_wallet_topups (merchant_id, created_at desc);

CREATE OR REPLACE FUNCTION public.business_create_topup_intent(
  _amount numeric,
  _razorpay_order_id text,
  _actor_label text DEFAULT NULL
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _mid uuid := public.business_require_delivery(); _min numeric; _max numeric; _id uuid;
begin
  if _razorpay_order_id is null or btrim(_razorpay_order_id) = '' then
    raise exception 'Order id required';
  end if;
  _min := public.courier_setting('business_topup_min', 500);
  _max := public.courier_setting('business_topup_max', 100000);
  if _amount is null or _amount < _min or _amount > _max then
    raise exception 'Top-up amount must be between % and %', _min, _max;
  end if;

  insert into public.business_wallet_topups(merchant_id, amount, razorpay_order_id, created_by_label)
  values (_mid, _amount, btrim(_razorpay_order_id), nullif(btrim(coalesce(_actor_label,'')),''))
  returning id into _id;

  perform public.business_audit(_mid, 'business_create_topup_intent', 'business_wallet_topups', _id,
    null, jsonb_build_object('amount', _amount, 'razorpay_order_id', btrim(_razorpay_order_id)), _actor_label);

  return _id;
end $function$;

REVOKE ALL ON FUNCTION public.business_create_topup_intent(numeric, text, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.business_create_topup_intent(numeric, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.business_confirm_topup(
  _razorpay_order_id text,
  _payment_id text,
  _amount_paid numeric
)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _t public.business_wallet_topups%rowtype;
begin
  if _razorpay_order_id is null or _payment_id is null then return false; end if;

  select * into _t from public.business_wallet_topups
   where razorpay_order_id = _razorpay_order_id for update;
  if not found then return false; end if;

  if _t.status = 'paid' then return true; end if;

  if _amount_paid is null or round(_amount_paid, 2) <> round(_t.amount, 2) then
    update public.business_wallet_topups
       set status = 'failed', razorpay_payment_id = _payment_id
     where id = _t.id;
    return false;
  end if;

  perform public.business_wallet_post(_t.merchant_id, 'credit', _t.amount, 'topup:' || _payment_id);

  update public.business_wallet_topups
     set status = 'paid', razorpay_payment_id = _payment_id, paid_at = now()
   where id = _t.id;

  return true;
end $function$;

REVOKE ALL ON FUNCTION public.business_confirm_topup(text, text, numeric) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.business_confirm_topup(text, text, numeric) TO service_role;

-- 6. staff manual adjustment ------------------------------------------------
CREATE OR REPLACE FUNCTION public.staff_business_wallet_adjust(
  _merchant_id uuid,
  _type text,
  _amount numeric,
  _reason text
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _uid uuid := auth.uid(); _staff uuid; _id uuid; _r text := btrim(coalesce(_reason,''));
begin
  perform public.business_require_ops();
  if _r = '' then raise exception 'Reason required'; end if;
  if _type not in ('credit','debit') then raise exception 'Invalid type'; end if;
  if _amount is null or _amount <= 0 then raise exception 'Amount must be positive'; end if;

  select id into _staff from public.staff_users where auth_user_id = _uid;

  _id := public.business_wallet_post(_merchant_id, _type, _amount,
           'adjust:' || _r || ':' || gen_random_uuid()::text, false, _staff);

  insert into public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  values (_uid, 'business_wallet_adjust', 'wallet_ledger', _id, null,
          jsonb_build_object('merchant_id', _merchant_id, 'type', _type, 'amount', _amount, 'reason', _r));

  return _id;
end $function$;

REVOKE ALL ON FUNCTION public.staff_business_wallet_adjust(uuid, text, numeric, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_business_wallet_adjust(uuid, text, numeric, text) TO authenticated, service_role;

-- 7. merchant read ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.business_get_wallet()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _mid uuid := public.business_require_delivery(); _bal numeric; _thr numeric; _rows jsonb;
begin
  select coalesce(delivery_wallet_balance,0) into _bal from public.merchants where id = _mid;
  select low_balance_threshold into _thr from public.business_profiles where merchant_id = _mid;

  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) into _rows
    from (
      select jsonb_build_object(
               'id', wl.id, 'amount', wl.amount, 'type', wl.type,
               'reason', wl.reason, 'created_at', wl.created_at) as x
        from public.wallet_ledger wl
       where wl.owner_type = 'merchant' and wl.owner_id = _mid and wl.wallet_type = 'delivery'
       order by wl.created_at desc
       limit 50
    ) s;

  return jsonb_build_object(
    'delivery_wallet_balance', _bal,
    'low_balance_threshold', coalesce(_thr, 500),
    'entries', _rows);
end $function$;

REVOKE ALL ON FUNCTION public.business_get_wallet() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.business_get_wallet() TO authenticated, service_role;