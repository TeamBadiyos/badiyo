CREATE OR REPLACE FUNCTION public.courier_cancel_fee_for(_order_id uuid)
 RETURNS TABLE(fee_base numeric, fee_gst numeric, fee_total numeric, refund_amount numeric, rider_share numeric)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _o public.courier_orders%rowtype; _t text; _v numeric; _taxable numeric; _total numeric; _w numeric; _online numeric;
begin
  select * into _o from public.courier_orders where id=_order_id;
  if _o.id is null then raise exception 'Order not found'; end if;
  if _o.source='business' and coalesce(_o.fare_breakdown,'{}'::jsonb) ? 'cancel_fee_type' then
    _t := _o.fare_breakdown->>'cancel_fee_type';
    _v := coalesce(nullif(_o.fare_breakdown->>'cancel_fee_value','')::numeric, 50);
  else
    _t := public.courier_setting_text('courier_cancel_fee_type','percent');
    _v := public.courier_setting('courier_cancel_fee_value', 50);
  end if;
  _w := greatest(coalesce(_o.wallet_amount,0),0);
  _online := greatest(coalesce(_o.total_amount,0),0);
  -- Fee is on the whole amount paid (wallet + online).
  _total := _online + _w;
  _taxable := greatest(_total - coalesce(_o.gst_amount,0), 0);
  if _t = 'flat' then fee_base := round(least(greatest(_v,0), _taxable),2);
  else fee_base := round(_taxable * least(greatest(_v,0),100) / 100, 2); end if;
  fee_gst := round(fee_base * coalesce(_o.gst_percent,0) / 100, 2);
  fee_total := least(fee_base + fee_gst, _total);
  -- Fee comes out of the wallet part first; refund_amount is the ONLINE refund.
  refund_amount := round(greatest(_online - greatest(fee_total - _w, 0), 0), 2);
  rider_share := round(fee_base * public.courier_setting('cancel_fee_expert_share_pct', 50) / 100, 2);
  return next;
end $function$;

CREATE OR REPLACE FUNCTION public.courier_cancel_order(_order_id uuid, _reason text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _o public.courier_orders%rowtype; _fee numeric := 0; _base numeric := 0; _gst numeric := 0;
  _refund numeric := 0; _expert_share numeric := 0; _f record;
  _wc numeric := 0; _wb numeric := 0; _left numeric; _rb numeric := 0; _rc numeric := 0;
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode='42501'; end if;
  select * into _o from public.courier_orders where id=_order_id for update;
  if _o.id is null or _o.customer_id <> auth.uid() then raise exception 'Forbidden' using errcode='42501'; end if;
  if _o.status not in ('REQUESTED','SEARCHING','DRIVER_ASSIGNED','ARRIVED_PICKUP') then
    raise exception 'This order can no longer be cancelled';
  end if;

  select greatest(coalesce(-sum(amount) filter (where bucket='cash'),0),0), greatest(coalesce(-sum(amount) filter (where bucket='bonus'),0),0)
    into _wc, _wb from public.customer_wallet_ledger
   where user_id=_o.customer_id and ref_type='courier_order' and ref_id=_order_id::text;

  if _o.payment_status in ('paid','refund_pending') then
    _refund := greatest(0, coalesce(_o.total_amount,0));
    if _o.status = 'ARRIVED_PICKUP' then
      select * into _f from public.courier_cancel_fee_for(_order_id);
      _base := _f.fee_base; _gst := _f.fee_gst; _fee := _f.fee_total;
      _refund := _f.refund_amount; _expert_share := _f.rider_share;
    end if;
  end if;

  -- Wallet part: fee taken from bonus first, then cash; rest back instantly.
  if _fee > 0 and (_wc + _wb) > 0 then
    _left := _fee;
    _rb := greatest(_wb - _left, 0); _left := greatest(_left - _wb, 0);
    _rc := greatest(_wc - _left, 0);
    if _rc > 0 then perform public.wallet_post(_o.customer_id,'refund_in','cash',_rc,'courier_order',_order_id::text,'Parcel cancelled · to badiyos Wallet',NULL,NULL); end if;
    if _rb > 0 then perform public.wallet_post(_o.customer_id,'bonus','bonus',_rb,'courier_order',_order_id::text,'Parcel cancelled · to badiyos Wallet',now()+make_interval(days=>public.wallet_bonus_days()),NULL); end if;
  end if;

  perform set_config('app.courier_actor_type','customer',true);
  perform set_config('app.courier_actor_id', _o.customer_id::text, true);

  -- With no fee, the status trigger returns the whole wallet part.
  update public.courier_orders
     set status='CANCELLED', cancelled_by='customer', cancelled_at=now(),
         cancel_reason_code = coalesce(_reason,'customer_cancelled'),
         cancellation_fee = _fee, cancellation_fee_base = _base, cancellation_fee_gst = _gst
   where id=_order_id;

  update public.courier_offers set status='cancelled' where order_id=_order_id and status='pending';

  if _o.assigned_expert_id is not null then
    update public.experts set is_busy=false where id=_o.assigned_expert_id;
    if _expert_share > 0 then
      insert into public.wallet_ledger (owner_type, owner_id, amount, type, reason)
      values ('expert', _o.assigned_expert_id, _expert_share, 'credit', 'courier_cancel_fee:' || _o.id::text);
      update public.experts set wallet_balance = coalesce(wallet_balance,0) + _expert_share
       where id = _o.assigned_expert_id;
    end if;
    perform public.notify_expert_alert(_o.assigned_expert_id, 'order_cancelled', 'Courier cancelled',
      'The courier order assigned to you was cancelled.', jsonb_build_object('order_id', _o.id));
  end if;

  perform public.courier_mark_refund_pending(_order_id, _refund, 'customer_cancelled');
  if _fee = 0 then _rc := _wc; _rb := _wb; end if;
  perform public.notify_customer_user_push(_o.customer_id, 'Courier cancelled',
    case when _refund + _rc + _rb > 0 then 'Refund of Rs ' || (_refund + _rc + _rb)::text || ' is being processed.'
         else 'Your courier order was cancelled.' end, 'home');
  return jsonb_build_object('ok', true, 'cancellation_fee', _fee, 'fee_base', _base, 'fee_gst', _gst,
    'refund_amount', _refund, 'refund_wallet', _rc + _rb, 'expert_credit', _expert_share);
end $function$;

CREATE OR REPLACE FUNCTION public.courier_wallet_return_on_end()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status IN ('CANCELLED','FAILED','EXPIRED') AND NEW.status IS DISTINCT FROM OLD.status
     AND coalesce(NEW.wallet_amount,0) > 0 AND coalesce(NEW.cancellation_fee,0) = 0 THEN
    PERFORM wallet_return(NEW.customer_id,'courier_order',NEW.id::text,'Parcel cancelled');
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.courier_wallet_return_on_end() FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.booking_refund_split(_booking_id uuid, _mode text DEFAULT 'policy'::text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE b record; _g text; _total numeric; _wc numeric; _wb numeric; _rzp numeric; _fee numeric := 0; _pct numeric; _noarr boolean;
  _stage text; _ref numeric; _left numeric; _rwb numeric; _rwc numeric; _ron numeric;
BEGIN
  SELECT * INTO b FROM public.bookings WHERE id=_booking_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;
  _g := public.booking_group_of(_booking_id);
  _total := coalesce(b.total_amount, b.price, 0);
  SELECT coalesce(-sum(amount) FILTER (WHERE bucket='cash'),0), coalesce(-sum(amount) FILTER (WHERE bucket='bonus'),0)
    INTO _wc, _wb FROM public.customer_wallet_ledger WHERE ref_type='booking' AND ref_id=_booking_id::text AND type='payment';
  _wc := greatest(_wc,0); _wb := greatest(_wb,0);
  _rzp := CASE WHEN coalesce(b.razorpay_payment_id,'') LIKE 'pay\_%' THEN greatest(_total - _wc - _wb, 0) ELSE 0 END;
  IF b.razorpay_payment_id IS NULL OR b.razorpay_payment_id = '' THEN
    IF _wc + _wb = 0 THEN _total := 0; END IF;
  END IF;
  _total := least(_total, _rzp + _wc + _wb);
  _pct := public.city_ops_num(b.city_id, _g || '_cancel_fee_percent', 50);
  _noarr := public.city_ops_text(b.city_id, _g || '_no_refund_after_arrived', '1') = '1';
  IF b.assigned_expert_id IS NULL THEN _stage := 'before_assign';
  ELSIF b.arrived_at IS NOT NULL OR b.status IN ('arrived','in_progress') THEN _stage := 'arrived';
  ELSE _stage := 'assigned'; END IF;
  IF _mode = 'full' OR _stage = 'before_assign' THEN _fee := 0;
  ELSIF _stage = 'arrived' AND _noarr THEN _fee := _total;
  ELSE _fee := round(_total * _pct / 100, 2); END IF;
  _ref := greatest(_total - _fee, 0);
  -- Fee taken from wallet bonus, then wallet cash, then online.
  _left := _fee;
  _rwb := greatest(_wb - _left, 0); _left := greatest(_left - _wb, 0);
  _rwc := greatest(_wc - _left, 0); _left := greatest(_left - _wc, 0);
  _ron := greatest(_rzp - _left, 0);
  RETURN jsonb_build_object('stage',_stage,'total_paid',_total,'fee',_fee,'fee_percent',_pct,'refund',_ref,
    'paid_wallet_cash',_wc,'paid_wallet_bonus',_wb,'paid_online',_rzp,
    'refund_wallet_cash', round(_rwc,2), 'refund_wallet_bonus', round(_rwb,2),
    'refund_online', round(greatest(_ref - _rwc - _rwb, 0),2));
END $function$;