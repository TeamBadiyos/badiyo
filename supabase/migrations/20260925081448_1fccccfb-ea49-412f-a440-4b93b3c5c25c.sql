-- new settings
insert into public.ops_settings (key, value, label) values
  ('courier_cancel_fee_pct', 50, 'Courier: cancellation fee as % of order total once rider reached pickup'),
  ('cancel_fee_expert_share_pct', 50, 'Share (%) of cancellation fee credited to the assigned expert')
on conflict (key) do nothing;

-- courier cancel: flat 50% of total, expert gets 50% of the fee
create or replace function public.courier_cancel_order(_order_id uuid, _reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _o public.courier_orders%rowtype; _fee numeric := 0; _refund numeric := 0; _expert_share numeric := 0;
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode='42501'; end if;
  select * into _o from public.courier_orders where id=_order_id for update;
  if _o.id is null or _o.customer_id <> auth.uid() then raise exception 'Forbidden' using errcode='42501'; end if;
  if _o.status not in ('REQUESTED','SEARCHING','DRIVER_ASSIGNED','ARRIVED_PICKUP') then
    raise exception 'This order can no longer be cancelled';
  end if;

  if _o.status = 'ARRIVED_PICKUP' then
    _fee := round(coalesce(_o.total_amount,0) * public.courier_setting('courier_cancel_fee_pct', 50) / 100, 2);
    _fee := greatest(_fee, 0);
  end if;

  if _o.payment_status in ('paid','refund_pending') then
    _refund := greatest(0, _o.total_amount - _fee);
  else
    _fee := 0;
  end if;

  perform set_config('app.courier_actor_type','customer',true);
  perform set_config('app.courier_actor_id', _o.customer_id::text, true);

  update public.courier_orders
     set status='CANCELLED', cancelled_by='customer', cancelled_at=now(),
         cancel_reason_code = coalesce(_reason,'customer_cancelled'),
         cancellation_fee = _fee
   where id=_order_id;

  update public.courier_offers set status='cancelled' where order_id=_order_id and status='pending';

  if _o.assigned_expert_id is not null then
    update public.experts set is_busy=false where id=_o.assigned_expert_id;
    if _fee > 0 then
      _expert_share := round(_fee * public.courier_setting('cancel_fee_expert_share_pct', 50) / 100, 2);
      if _expert_share > 0 then
        insert into public.wallet_ledger (owner_type, owner_id, amount, type, reason)
        values ('expert', _o.assigned_expert_id, _expert_share, 'credit', 'courier_cancel_fee:' || _o.id::text);
        update public.experts set wallet_balance = coalesce(wallet_balance,0) + _expert_share
         where id = _o.assigned_expert_id;
      end if;
    end if;
    perform public.notify_expert_alert(_o.assigned_expert_id, 'order_cancelled', 'Courier cancelled',
      'The courier order assigned to you was cancelled.', jsonb_build_object('order_id', _o.id));
  end if;

  perform public.courier_mark_refund_pending(_order_id, _refund, 'customer_cancelled');
  perform public.notify_customer_user_push(_o.customer_id, 'Courier cancelled',
    case when _refund > 0 then 'Refund of Rs ' || _refund::text || ' is being processed.'
         else 'Your courier order was cancelled.' end, 'home');
  return jsonb_build_object('ok', true, 'cancellation_fee', _fee, 'refund_amount', _refund,
    'expert_credit', _expert_share);
end $$;

-- booking cancel: credit 50% of the cancellation fee to the assigned expert
CREATE OR REPLACE FUNCTION public.customer_cancel_booking_apply(_booking_id uuid, _cancellation_fee numeric, _refund_amount numeric, _refund_id text, _refund_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _current text;
  _assigned uuid;
  _owner uuid;
  _before jsonb;
  _after jsonb;
  _expert_share numeric := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT to_jsonb(b), b.status, b.assigned_expert_id, b.user_id
    INTO _before, _current, _assigned, _owner
    FROM public.bookings b WHERE b.id = _booking_id FOR UPDATE;
  IF _before IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _owner IS DISTINCT FROM _uid THEN RAISE EXCEPTION 'Forbidden'; END IF;

  IF _current NOT IN ('confirmed','accepted','expert_assigned') THEN
    RAISE EXCEPTION 'Cannot cancel — service has already started or booking is in terminal state (status: %)', _current;
  END IF;

  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings
     SET status = 'cancelled',
         cancellation_reason = 'customer_cancelled',
         cancellation_fee = _cancellation_fee,
         refund_amount = _refund_amount,
         refund_id = _refund_id,
         refund_status = _refund_status,
         cancelled_by = 'customer',
         cancelled_at = now()
   WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass','off', true);

  IF _assigned IS NOT NULL THEN
    UPDATE public.experts SET is_busy = false WHERE id = _assigned;

    IF coalesce(_cancellation_fee, 0) > 0 THEN
      _expert_share := round(_cancellation_fee * public.courier_setting('cancel_fee_expert_share_pct', 50) / 100, 2);
      IF _expert_share > 0 THEN
        INSERT INTO public.wallet_ledger (owner_type, owner_id, amount, type, reason)
        VALUES ('expert', _assigned, _expert_share, 'credit', 'booking_cancel_fee:' || _booking_id::text);
        UPDATE public.experts SET wallet_balance = coalesce(wallet_balance,0) + _expert_share
         WHERE id = _assigned;
      END IF;
    END IF;
  END IF;

  SELECT to_jsonb(b) INTO _after FROM public.bookings b WHERE id = _booking_id;
  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'customer_cancel_booking', 'bookings', _booking_id, _before,
          _after || jsonb_build_object('actor_role','customer'));

  PERFORM public.notify_customer_push(
    _booking_id,
    'Booking cancelled',
    CASE
      WHEN _refund_amount > 0 THEN 'Your booking was cancelled. Refund of ₹' || _refund_amount::text || ' is being processed.'
      ELSE 'Your booking was cancelled. No refund applicable.'
    END,
    'home'
  );

  IF _assigned IS NOT NULL THEN
    PERFORM public.notify_expert_alert(
      _assigned,
      'order_cancelled',
      'Booking cancelled',
      'The booking assigned to you was cancelled by the customer.',
      jsonb_build_object('booking_id', _booking_id, 'route', 'home')
    );
  END IF;

  RETURN jsonb_build_object(
    'new_status','cancelled',
    'cancellation_fee', _cancellation_fee,
    'refund_amount', _refund_amount,
    'refund_id', _refund_id,
    'refund_status', _refund_status,
    'expert_credit', _expert_share
  );
END;$function$;