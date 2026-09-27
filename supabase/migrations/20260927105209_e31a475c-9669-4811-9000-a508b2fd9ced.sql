-- settings
insert into public.ops_settings(key,value,label)
select 'courier_cancel_fee_type','percent','Courier: cancellation fee type (percent or flat)' where not exists (select 1 from public.ops_settings where key='courier_cancel_fee_type');
insert into public.ops_settings(key,value,label)
select 'courier_cancel_fee_value', coalesce((select value from public.ops_settings where key='courier_cancel_fee_pct'),'50'), 'Courier: cancellation fee value (% of pre-GST total, or rupees), GST added on top'
where not exists (select 1 from public.ops_settings where key='courier_cancel_fee_value');

create or replace function public.courier_setting_text(_key text, _default text)
returns text language sql stable security definer set search_path to 'public' as $$
  select coalesce((select nullif(btrim(value),'') from public.ops_settings where key=_key), _default)
$$;
revoke execute on function public.courier_setting_text(text,text) from public, anon, authenticated;

-- plans
alter table public.bulk_pricing_plans
  add column if not exists cancel_fee_type text not null default 'percent',
  add column if not exists cancel_fee_value numeric not null default 50;
alter table public.bulk_pricing_plans drop constraint if exists bulk_pricing_plans_cancel_fee_type_chk;
alter table public.bulk_pricing_plans add constraint bulk_pricing_plans_cancel_fee_type_chk check (cancel_fee_type in ('percent','flat'));

create or replace function public.bulk_pricing_plans_validate_cancel_fee()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if NEW.cancel_fee_value < 0 then raise exception 'Cancellation fee cannot be negative'; end if;
  if NEW.cancel_fee_type='percent' and NEW.cancel_fee_value > 100 then raise exception 'Cancellation fee percent cannot exceed 100'; end if;
  return NEW;
end $$;
drop trigger if exists bulk_pricing_plans_validate_cancel_fee on public.bulk_pricing_plans;
create trigger bulk_pricing_plans_validate_cancel_fee before insert or update on public.bulk_pricing_plans
for each row execute function public.bulk_pricing_plans_validate_cancel_fee();

-- order columns
alter table public.courier_orders
  add column if not exists cancellation_fee_base numeric,
  add column if not exists cancellation_fee_gst numeric;

-- snapshot plan fee into business trip fare at creation
create or replace function public.courier_orders_snapshot_cancel_fee()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare _t text; _v numeric;
begin
  if NEW.source = 'business' and NEW.business_merchant_id is not null
     and not (coalesce(NEW.fare_breakdown,'{}'::jsonb) ? 'cancel_fee_type') then
    select p.cancel_fee_type, p.cancel_fee_value into _t, _v
      from public.business_profiles b join public.bulk_pricing_plans p on p.id=b.pricing_plan_id
     where b.merchant_id = NEW.business_merchant_id;
    if _t is not null then
      NEW.fare_breakdown := coalesce(NEW.fare_breakdown,'{}'::jsonb)
        || jsonb_build_object('cancel_fee_type',_t,'cancel_fee_value',_v);
    end if;
  end if;
  return NEW;
end $$;
drop trigger if exists courier_orders_snapshot_cancel_fee on public.courier_orders;
create trigger courier_orders_snapshot_cancel_fee before insert on public.courier_orders
for each row execute function public.courier_orders_snapshot_cancel_fee();
revoke execute on function public.courier_orders_snapshot_cancel_fee() from public, anon, authenticated;

-- helper
create or replace function public.courier_cancel_fee_for(_order_id uuid)
returns table(fee_base numeric, fee_gst numeric, fee_total numeric, refund_amount numeric, rider_share numeric)
language plpgsql stable security definer set search_path to 'public' as $$
declare _o public.courier_orders%rowtype; _t text; _v numeric; _taxable numeric; _total numeric;
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
  _total := greatest(coalesce(_o.total_amount,0),0);
  _taxable := greatest(_total - coalesce(_o.gst_amount,0), 0);
  if _t = 'flat' then fee_base := round(least(greatest(_v,0), _taxable),2);
  else fee_base := round(_taxable * least(greatest(_v,0),100) / 100, 2); end if;
  fee_gst := round(fee_base * coalesce(_o.gst_percent,0) / 100, 2);
  fee_total := fee_base + fee_gst;
  refund_amount := round(greatest(_total - fee_total, 0), 2);
  rider_share := round(fee_base * public.courier_setting('cancel_fee_expert_share_pct', 50) / 100, 2);
  return next;
end $$;
revoke execute on function public.courier_cancel_fee_for(uuid) from public, anon, authenticated;
grant execute on function public.courier_cancel_fee_for(uuid) to service_role;

-- business_reject_trip_internal (from live)
CREATE OR REPLACE FUNCTION public.business_reject_trip_internal(_cid uuid, _reason text, _by text, _allow_assigned boolean)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _o public.courier_orders%rowtype; _fee numeric := 0; _base numeric := 0; _gst numeric := 0;
  _share numeric := 0; _refund numeric; _actor text; _f record;
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

  _refund := round(greatest(0, coalesce(_o.total_amount,0)),2);
  if _o.status = 'ARRIVED_PICKUP' then
    select * into _f from public.courier_cancel_fee_for(_cid);
    _base := _f.fee_base; _gst := _f.fee_gst; _fee := _f.fee_total; _share := _f.rider_share; _refund := _f.refund_amount;
  end if;

  _actor := case when _by = 'business' then 'customer' else 'staff' end;
  perform set_config('app.courier_actor_type', _actor, true);
  if _actor = 'customer' then perform set_config('app.courier_actor_id', _o.customer_id::text, true); end if;
  update public.courier_orders
     set status='CANCELLED', cancelled_by=_actor, cancelled_at=now(),
         cancel_reason_code=coalesce(_reason,'auto_rejected'), needs_ops_attention=false,
         cancellation_fee=_fee, cancellation_fee_base=_base, cancellation_fee_gst=_gst
   where id=_cid;
  update public.courier_offers set status='cancelled' where order_id=_cid and status='pending';

  if _o.assigned_expert_id is not null then
    update public.experts set is_busy=false where id=_o.assigned_expert_id;
    if _share > 0 then
      insert into public.wallet_ledger (owner_type, owner_id, amount, type, reason)
      values ('expert', _o.assigned_expert_id, _share, 'credit', 'courier_cancel_fee:' || _o.id::text);
      update public.experts set wallet_balance = coalesce(wallet_balance,0) + _share where id=_o.assigned_expert_id;
    end if;
    perform public.notify_expert_alert(_o.assigned_expert_id, 'order_cancelled', 'Courier cancelled',
      'The courier order assigned to you was cancelled.', jsonb_build_object('order_id', _o.id));
  end if;
  return jsonb_build_object('ok',true,'cancellation_fee',_fee,'fee_base',_base,'fee_gst',_gst,
    'refund_amount', _refund, 'rider_share',_share);
end $function$;

-- courier_cancel_order (from live)
CREATE OR REPLACE FUNCTION public.courier_cancel_order(_order_id uuid, _reason text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _o public.courier_orders%rowtype; _fee numeric := 0; _base numeric := 0; _gst numeric := 0;
  _refund numeric := 0; _expert_share numeric := 0; _f record;
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode='42501'; end if;
  select * into _o from public.courier_orders where id=_order_id for update;
  if _o.id is null or _o.customer_id <> auth.uid() then raise exception 'Forbidden' using errcode='42501'; end if;
  if _o.status not in ('REQUESTED','SEARCHING','DRIVER_ASSIGNED','ARRIVED_PICKUP') then
    raise exception 'This order can no longer be cancelled';
  end if;

  if _o.payment_status in ('paid','refund_pending') then
    _refund := greatest(0, coalesce(_o.total_amount,0));
    if _o.status = 'ARRIVED_PICKUP' then
      select * into _f from public.courier_cancel_fee_for(_order_id);
      _base := _f.fee_base; _gst := _f.fee_gst; _fee := _f.fee_total;
      _refund := _f.refund_amount; _expert_share := _f.rider_share;
    end if;
  end if;

  perform set_config('app.courier_actor_type','customer',true);
  perform set_config('app.courier_actor_id', _o.customer_id::text, true);

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
  perform public.notify_customer_user_push(_o.customer_id, 'Courier cancelled',
    case when _refund > 0 then 'Refund of Rs ' || _refund::text || ' is being processed.'
         else 'Your courier order was cancelled.' end, 'home');
  return jsonb_build_object('ok', true, 'cancellation_fee', _fee, 'fee_base', _base, 'fee_gst', _gst,
    'refund_amount', _refund, 'expert_credit', _expert_share);
end $function$;

-- staff_upsert_pricing_plan with fee params
drop function if exists public.staff_upsert_pricing_plan(uuid,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,boolean);
CREATE OR REPLACE FUNCTION public.staff_upsert_pricing_plan(_id uuid, _name text, _base_fare numeric, _included_km numeric, _per_km numeric, _min_fare numeric, _extra_drop_fee numeric, _return_per_km numeric, _commission_pct numeric, _is_active boolean DEFAULT true, _cancel_fee_type text DEFAULT 'percent', _cancel_fee_value numeric DEFAULT 50)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _old jsonb; _new public.bulk_pricing_plans;
begin
  perform public.business_require_super_admin();
  if coalesce(btrim(_name),'')='' then raise exception 'Name is required'; end if;
  if coalesce(_cancel_fee_type,'percent') not in ('percent','flat') then raise exception 'Fee type must be percent or flat'; end if;
  if _id is null then
    insert into public.bulk_pricing_plans(name,base_fare,included_km,per_km,min_fare,extra_drop_fee,return_per_km,commission_pct,is_active,cancel_fee_type,cancel_fee_value)
    values (btrim(_name),_base_fare,_included_km,_per_km,_min_fare,_extra_drop_fee,_return_per_km,_commission_pct,coalesce(_is_active,true),coalesce(_cancel_fee_type,'percent'),coalesce(_cancel_fee_value,50)) returning * into _new;
  else
    select to_jsonb(p) into _old from public.bulk_pricing_plans p where id=_id for update;
    if _old is null then raise exception 'Plan not found'; end if;
    if (_old->>'is_active')::boolean and not coalesce(_is_active,true)
       and exists (select 1 from public.business_profiles b join public.merchants m on m.id=b.merchant_id where b.pricing_plan_id=_id and m.delivery_status='active') then
      raise exception 'Plan is assigned to an active business; use staff_set_plan_active'; end if;
    update public.bulk_pricing_plans set name=btrim(_name),base_fare=_base_fare,included_km=_included_km,per_km=_per_km,min_fare=_min_fare,
      extra_drop_fee=_extra_drop_fee,return_per_km=_return_per_km,commission_pct=_commission_pct,is_active=coalesce(_is_active,true),
      cancel_fee_type=coalesce(_cancel_fee_type,'percent'),cancel_fee_value=coalesce(_cancel_fee_value,50)
      where id=_id returning * into _new;
  end if;
  perform public.business_audit('staff_upsert_pricing_plan','bulk_pricing_plans',_new.id,_old,to_jsonb(_new),null);
  return _new.id;
end $function$;
revoke execute on function public.staff_upsert_pricing_plan(uuid,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,boolean,text,numeric) from public, anon;
grant execute on function public.staff_upsert_pricing_plan(uuid,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,boolean,text,numeric) to authenticated, service_role;

-- staff_set_cancel_fee
create or replace function public.staff_set_cancel_fee(_type text, _value numeric, _rider_share_pct numeric)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _before jsonb; _after jsonb;
begin
  perform public.business_require_super_admin();
  if _type not in ('percent','flat') then raise exception 'Fee type must be percent or flat'; end if;
  if _value is null or _value < 0 then raise exception 'Fee value must be 0 or more'; end if;
  if _type='percent' and _value > 100 then raise exception 'Fee percent cannot exceed 100'; end if;
  if _rider_share_pct is null or _rider_share_pct < 0 or _rider_share_pct > 100 then raise exception 'Rider share must be 0-100'; end if;
  select jsonb_object_agg(key,value) into _before from public.ops_settings
   where key in ('courier_cancel_fee_type','courier_cancel_fee_value','cancel_fee_expert_share_pct');
  insert into public.ops_settings(key,value,label) values
    ('courier_cancel_fee_type',_type,'Courier: cancellation fee type (percent or flat)'),
    ('courier_cancel_fee_value',_value::text,'Courier: cancellation fee value'),
    ('cancel_fee_expert_share_pct',_rider_share_pct::text,'Rider share of cancellation fee (%)')
  on conflict (key) do update set value=excluded.value;
  _after := jsonb_build_object('courier_cancel_fee_type',_type,'courier_cancel_fee_value',_value::text,'cancel_fee_expert_share_pct',_rider_share_pct::text);
  perform public.business_audit('staff_set_cancel_fee','ops_settings',null,_before,_after,null);
  return _after;
end $$;
revoke execute on function public.staff_set_cancel_fee(text,numeric,numeric) from public, anon;
grant execute on function public.staff_set_cancel_fee(text,numeric,numeric) to authenticated, service_role;