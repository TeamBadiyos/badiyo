
create or replace function public.business_reject_trip_internal(_cid uuid, _reason text, _by text, _allow_assigned boolean)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare _o public.courier_orders%rowtype; _fee numeric := 0; _share numeric := 0; _actor text;
begin
  select * into _o from public.courier_orders where id=_cid for update;
  if _o.id is null or _o.source is distinct from 'business' then return jsonb_build_object('ok',false,'reason','NOT_BUSINESS_TRIP'); end if;
  if exists (select 1 from public.courier_order_stops s where s.order_id=_cid and s.stop_type='pickup' and s.completed_at is not null) then
    return jsonb_build_object('ok',false,'reason','PICKED_UP');
  end if;
  if _allow_assigned then
    if _o.status not in ('REQUESTED','SEARCHING','DRIVER_ASSIGNED','ARRIVED_PICKUP') then
      return jsonb_build_object('ok',false,'reason','PICKED_UP'); end if;
  else
    if _o.assigned_expert_id is not null or _o.status not in ('REQUESTED','SEARCHING') then
      return jsonb_build_object('ok',false,'reason','NOT_UNASSIGNED'); end if;
  end if;

  if _o.status = 'ARRIVED_PICKUP' then
    _fee := greatest(0, round(coalesce(_o.total_amount,0) * public.courier_setting('courier_cancel_fee_pct', 50) / 100, 2));
  end if;

  -- the business owner is the trip's customer
  _actor := case when _by = 'business' then 'customer' else 'staff' end;
  perform set_config('app.courier_actor_type', _actor, true);
  if _actor = 'customer' then perform set_config('app.courier_actor_id', _o.customer_id::text, true); end if;
  update public.courier_orders
     set status='CANCELLED', cancelled_by=_actor, cancelled_at=now(),
         cancel_reason_code=coalesce(_reason,'auto_rejected'), needs_ops_attention=false, cancellation_fee=_fee
   where id=_cid;
  update public.courier_offers set status='cancelled' where order_id=_cid and status='pending';

  if _o.assigned_expert_id is not null then
    update public.experts set is_busy=false where id=_o.assigned_expert_id;
    if _fee > 0 then
      _share := round(_fee * public.courier_setting('cancel_fee_expert_share_pct', 50) / 100, 2);
      if _share > 0 then
        insert into public.wallet_ledger (owner_type, owner_id, amount, type, reason)
        values ('expert', _o.assigned_expert_id, _share, 'credit', 'courier_cancel_fee:' || _o.id::text);
        update public.experts set wallet_balance = coalesce(wallet_balance,0) + _share where id=_o.assigned_expert_id;
      end if;
    end if;
    perform public.notify_expert_alert(_o.assigned_expert_id, 'order_cancelled', 'Courier cancelled',
      'The courier order assigned to you was cancelled.', jsonb_build_object('order_id', _o.id));
  end if;
  return jsonb_build_object('ok',true,'cancellation_fee',_fee,
    'refund_amount', round(greatest(0, coalesce(_o.total_amount,0) - _fee),2), 'rider_share',_share);
end $function$;
revoke all on function public.business_reject_trip_internal(uuid,text,text,boolean) from public, anon, authenticated;
