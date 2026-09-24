CREATE OR REPLACE FUNCTION public.courier_settle_order(_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _o public.courier_orders%rowtype; _earn numeric; _pct numeric; _extra numeric;
begin
  select * into _o from public.courier_orders where id=_order_id for update;
  if _o.id is null or _o.earnings_credited_at is not null then return; end if;

  select coalesce(sum(amount),0) into _extra from public.courier_order_charges where order_id=_o.id and status='paid';

  if _o.status = 'DELIVERED' then
    update public.courier_orders set status='COMPLETED', completed_at=now() where id=_o.id;
    _earn := round((_o.base_amount + _o.extra_fee + coalesce(_o.stops_fee,0)) * (100 - _o.commission_pct) / 100, 2);
  elsif _o.status = 'FAILED_DELIVERY' and public.courier_order_clean_return(_o.id) then
    update public.courier_orders set status='COMPLETED', completed_at=now() where id=_o.id;
    _earn := round((_o.base_amount + _o.extra_fee + coalesce(_o.stops_fee,0)) * (100 - _o.commission_pct) / 100, 2);
  elsif _o.status = 'FAILED_DELIVERY' then
    _pct := public.courier_setting('courier_failed_delivery_payout_pct', 50);
    _earn := round((_o.base_amount + coalesce(_o.stops_fee,0)) * _pct / 100 * (100 - _o.commission_pct) / 100, 2);
  elsif _o.status = 'CANCELLED' and _o.cancel_reason_code = 'ALL_PICKUPS_FAILED' then
    _earn := round((_o.base_amount + _o.extra_fee + coalesce(_o.stops_fee,0)) * (100 - _o.commission_pct) / 100, 2);
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
end $function$;