CREATE OR REPLACE FUNCTION public.courier_order_clean_return(_order_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  select exists (select 1 from public.courier_orders where id=_order_id and status='FAILED_DELIVERY' and incident_code is null)
     and not exists (select 1 from public.courier_order_stops where order_id=_order_id and status not in ('completed','failed','cancelled'))
     and not exists (select 1 from public.courier_order_stops where order_id=_order_id and stop_type='return' and status <> 'completed')
$f$;
REVOKE ALL ON FUNCTION public.courier_order_clean_return(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.courier_order_clean_return(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.courier_settle_order(_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
declare _o public.courier_orders%rowtype; _earn numeric; _pct numeric; _extra numeric;
begin
  select * into _o from public.courier_orders where id=_order_id for update;
  if _o.id is null or _o.earnings_credited_at is not null then return; end if;

  select coalesce(sum(amount),0) into _extra from public.courier_order_charges where order_id=_o.id and status='paid';

  if _o.status = 'DELIVERED' then
    update public.courier_orders set status='COMPLETED', completed_at=now() where id=_o.id;
    _earn := round((_o.base_amount + _o.extra_fee) * (100 - _o.commission_pct) / 100, 2);
  elsif _o.status = 'FAILED_DELIVERY' and public.courier_order_clean_return(_o.id) then
    update public.courier_orders set status='COMPLETED', completed_at=now() where id=_o.id;
    _earn := round((_o.base_amount + _o.extra_fee) * (100 - _o.commission_pct) / 100, 2);
  elsif _o.status = 'FAILED_DELIVERY' then
    _pct := public.courier_setting('courier_failed_delivery_payout_pct', 50);
    _earn := round(_o.base_amount * _pct / 100 * (100 - _o.commission_pct) / 100, 2);
  elsif _o.status = 'CANCELLED' and _o.cancel_reason_code = 'ALL_PICKUPS_FAILED' then
    _earn := round((_o.base_amount + _o.extra_fee) * (100 - _o.commission_pct) / 100, 2);
  else
    return;
  end if;

  if _extra > 0 then
    _earn := _earn + round(_extra * (100 - _o.commission_pct) / 100, 2);
  end if;

  if _o.assigned_expert_id is not null and _earn > 0 then
    insert into public.wallet_ledger (owner_type, owner_id, amount, type, reason)
    values ('expert', _o.assigned_expert_id, _earn, 'credit', 'courier_order:' || _o.id::text);
    update public.experts set wallet_balance = coalesce(wallet_balance,0) + _earn, is_busy = false
     where id = _o.assigned_expert_id;
    perform public.notify_expert_push(_o.assigned_expert_id, 'Earning credited',
      'Rs ' || _earn::text || ' added to your wallet for a courier delivery.', 'wallet');
  end if;

  update public.courier_orders set earnings_credited_at = now() where id = _o.id;
end $f$;

CREATE OR REPLACE FUNCTION public.courier_sweeper_tick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
declare _r record; _esc int;
begin
  perform public.courier_sweeper();
  perform public.courier_dispatch_refund_job();
  begin
    _esc := public.courier_setting('courier_return_payment_escalation_minutes', 15)::int;
    for _r in select distinct o.id, o.order_code, o.total_amount
                from public.courier_order_stops s
                join public.courier_orders o on o.id=s.order_id
               where s.stop_type='return' and s.status='arrived'
                 and s.arrived_at < now() - make_interval(mins => _esc)
                 and not coalesce(o.needs_ops_attention,false)
                 and exists (select 1 from public.courier_order_charges c
                              join public.courier_order_parcels p on p.id=c.parcel_id
                             where p.return_stop_id=s.id and c.status='pending') loop
      update public.courier_orders set needs_ops_attention=true where id=_r.id;
      insert into public.courier_order_events(order_id, from_status, to_status, actor_type, actor_id, meta)
      values (_r.id, null, null, 'system', null, jsonb_build_object('event','return_payment_escalated'));
      perform public.admin_alert_enqueue('courier_return_payment', _r.id, coalesce(_r.order_code,'Parcel return'),
                                         'Return charge unpaid', _r.total_amount, 'Now');
    end loop;

    for _r in select id from public.courier_orders
               where earnings_credited_at is null
                 and ((status='CANCELLED' and cancel_reason_code='ALL_PICKUPS_FAILED')
                      or (status='FAILED_DELIVERY' and incident_code is null)) loop
      if (select status from public.courier_orders where id=_r.id) = 'FAILED_DELIVERY'
         and not public.courier_order_clean_return(_r.id) then continue; end if;
      perform set_config('app.courier_actor_type','system',true);
      perform public.courier_settle_order(_r.id);
    end loop;
  exception when others then raise warning 'courier_sweeper_tick extras failed: %', sqlerrm;
  end;
end $f$;