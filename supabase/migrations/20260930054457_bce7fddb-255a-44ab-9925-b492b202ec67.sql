-- ============================================================
-- A. Merchant credit reliability + B. Store commission engine
-- ============================================================

-- ---------- B.3 settings ----------
insert into public.ops_settings (key, value, label) values
  ('store_default_commission_pct', '0',  'Store: default commission % applied to new merchants at approval'),
  ('store_commission_gst_enabled', '0',  'Store: charge GST on the store commission (1=on)'),
  ('store_commission_gst_pct',     '18', 'Store: GST % charged on the store commission')
on conflict (key) do nothing;

-- ---------- B.5 snapshot columns on merchant_orders ----------
alter table public.merchant_orders
  add column if not exists commission_pct        numeric not null default 0,
  add column if not exists commission_gst_pct    numeric not null default 0,
  add column if not exists commission_gst_amount numeric not null default 0,
  add column if not exists merchant_net          numeric not null default 0;

alter table public.merchant_orders
  alter column commission_amount set default 0;

update public.merchant_orders set commission_amount = 0 where commission_amount is null;

-- ---------- A.2 idempotency: one merchant ledger row per reason ----------
create unique index if not exists wallet_ledger_merchant_reason_uidx
  on public.wallet_ledger (owner_type, owner_id, reason)
  where owner_type = 'merchant';

-- ---------- helper: commission snapshot for a merchant ----------
create or replace function public.store_commission_snapshot(_merchant_id uuid, _items_total numeric)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  _pct numeric; _gst_on boolean; _gst_pct numeric;
  _amt numeric; _gst numeric; _net numeric;
begin
  select case
           when m.commission_type = 'PERCENTAGE' and coalesce(m.commission_value,0) > 0 then m.commission_value
           else public.store_setting('store_default_commission_pct', 0)
         end
    into _pct
    from public.merchants m where m.id = _merchant_id;

  _pct := least(greatest(coalesce(_pct, 0), 0), 50);
  _gst_on := public.store_setting('store_commission_gst_enabled', 0) >= 1;
  _gst_pct := case when _gst_on then greatest(public.store_setting('store_commission_gst_pct', 18), 0) else 0 end;

  _amt := round(coalesce(_items_total,0) * _pct / 100.0, 2);
  _gst := round(_amt * _gst_pct / 100.0, 2);
  _net := round(coalesce(_items_total,0) - _amt - _gst, 2);

  return jsonb_build_object(
    'commission_pct', _pct,
    'commission_amount', _amt,
    'commission_gst_pct', _gst_pct,
    'commission_gst_amount', _gst,
    'merchant_net', greatest(_net, 0));
end $$;

revoke all on function public.store_commission_snapshot(uuid, numeric) from public, anon, authenticated;
grant execute on function public.store_commission_snapshot(uuid, numeric) to service_role;

-- ---------- B.5 store_create_order snapshots commission ----------
create or replace function public.store_create_order(_merchant_id uuid, _items jsonb, _address_id uuid, _payment_mode text default 'online'::text, _note text default null::text)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  _uid uuid := auth.uid(); _m record; _addr record; _it jsonb; _p record;
  _qty int; _items_total numeric := 0; _fee numeric; _quote jsonb;
  _order_id uuid; _num text; _count int := 0; _phone text; _name text;
  _want text; _prev record; _reused boolean := false; _exp int; _comm jsonb;
begin
  if _uid is null then return jsonb_build_object('ok', false, 'code', 'unauthenticated'); end if;
  if _items is null or jsonb_typeof(_items) <> 'array' or jsonb_array_length(_items) = 0 then
    return jsonb_build_object('ok', false, 'code', 'empty_cart'); end if;
  if coalesce(_payment_mode,'online') <> 'online' then
    return jsonb_build_object('ok', false, 'code', 'online_only'); end if;

  select * into _m from public.public_stores where id = _merchant_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'store_unavailable'); end if;
  if coalesce(_m.is_open_now,false) = false or coalesce(_m.is_accepting_orders,false) = false then
    return jsonb_build_object('ok', false, 'code', 'store_closed'); end if;

  select * into _addr from public.addresses where id = _address_id and user_id = _uid;
  if not found then return jsonb_build_object('ok', false, 'code', 'bad_address'); end if;

  _quote := public.store_courier_fare(_merchant_id, _addr.latitude, _addr.longitude);
  if not coalesce((_quote->>'ok')::boolean, false) then
    return jsonb_build_object('ok', false, 'code', coalesce(_quote->>'code','delivery_unavailable')); end if;
  _fee := (_quote->>'delivery_fee')::numeric;

  -- Reuse a still-open unpaid order for the same shop and identical cart.
  select string_agg(pid || ':' || q, ',' order by pid) into _want from (
    select (e->>'product_id') as pid, sum(greatest(1, least(50, coalesce((e->>'quantity')::int, 1)))) as q
      from jsonb_array_elements(_items) e group by 1) s;
  _exp := public.store_setting('store_unpaid_expiry_minutes', 10)::int;
  for _prev in select o.id, o.order_number,
        (select string_agg(i.product_id::text || ':' || i.quantity, ',' order by i.product_id::text)
           from public.merchant_order_items i where i.order_id = o.id) as sig
      from public.merchant_orders o
     where o.user_id = _uid and o.merchant_id = _merchant_id and o.status = 'pending'
       and o.payment_mode = 'online' and coalesce(o.payment_status,'pending') = 'pending'
       and o.created_at >= now() - make_interval(mins => _exp)
     order by o.created_at desc for update
  loop
    if not _reused and _prev.sig = _want then
      _reused := true; _order_id := _prev.id; _num := _prev.order_number;
    else
      update public.merchant_orders set cancel_reason = 'PAYMENT_NOT_COMPLETED' where id = _prev.id;
      perform public.store_set_status(_prev.id, 'cancelled', 'store_unpaid_replaced', jsonb_build_object('reason','PAYMENT_NOT_COMPLETED'));
    end if;
  end loop;

  select phone, full_name into _phone, _name from public.users where id = _uid;

  if _reused then
    delete from public.merchant_order_items where order_id = _order_id;
    update public.merchant_orders set address_id = _address_id,
      delivery_address = nullif(btrim(concat_ws(', ', nullif(_addr.full_address,''), nullif(_addr.area,''), nullif(_addr.city,''))), ''),
      delivery_lat = _addr.latitude, delivery_lng = _addr.longitude, customer_phone = _phone, customer_name = _name,
      customer_note = nullif(btrim(coalesce(_note,'')), ''), delivery_quote = _quote, updated_at = now()
     where id = _order_id;
  else
    _order_id := gen_random_uuid();
    _num := 'BS' || to_char(now() at time zone 'Asia/Kolkata', 'YYMMDD') || lpad((floor(random()*100000))::int::text, 5, '0');
    insert into public.merchant_orders (id, merchant_id, user_id, order_number, status, total_amount,
      address_id, delivery_address, delivery_lat, delivery_lng, customer_phone, customer_name,
      payment_mode, payment_status, items_total, delivery_fee, customer_note, source, delivery_quote)
    values (_order_id, _merchant_id, _uid, _num, 'pending', 0, _address_id,
      nullif(btrim(concat_ws(', ', nullif(_addr.full_address,''), nullif(_addr.area,''), nullif(_addr.city,''))), ''),
      _addr.latitude, _addr.longitude, _phone, _name, 'online', 'pending', 0, 0,
      nullif(btrim(coalesce(_note,'')), ''), 'customer_app', _quote);
  end if;

  for _it in select * from jsonb_array_elements(_items) loop
    _qty := greatest(1, least(50, coalesce((_it->>'quantity')::int, 1)));
    select p.id, p.name, p.price, p.stock_quantity into _p from public.products p
      join public.public_products pp on pp.id = p.id
     where p.id = (_it->>'product_id')::uuid and p.merchant_id = _merchant_id;
    if not found then raise exception 'product_unavailable'; end if;
    if coalesce(_p.stock_quantity,0) < _qty then raise exception 'out_of_stock'; end if;
    insert into public.merchant_order_items (order_id, product_id, product_name_snapshot, price_snapshot, quantity)
    values (_order_id, _p.id, _p.name, _p.price, _qty);
    _items_total := _items_total + (_p.price * _qty); _count := _count + 1;
  end loop;
  if _count = 0 then raise exception 'empty_cart'; end if;
  if _items_total < public.store_setting('store_min_order_amount', 0) then raise exception 'below_min_order'; end if;

  -- Commission snapshot: items only, never the delivery fee. Customer bill unchanged.
  _comm := public.store_commission_snapshot(_merchant_id, _items_total);

  update public.merchant_orders set items_total = _items_total, delivery_fee = _fee,
         total_amount = _items_total + _fee,
         commission_pct        = (_comm->>'commission_pct')::numeric,
         commission_amount     = (_comm->>'commission_amount')::numeric,
         commission_gst_pct    = (_comm->>'commission_gst_pct')::numeric,
         commission_gst_amount = (_comm->>'commission_gst_amount')::numeric,
         merchant_net          = (_comm->>'merchant_net')::numeric,
         updated_at = now()
   where id = _order_id;

  perform public.store_audit(_order_id, case when _reused then 'store_order_reused' else 'store_order_created' end, null,
    jsonb_build_object('status','pending','total', _items_total + _fee, 'delivery_fee', _fee, 'commission', _comm));

  return jsonb_build_object('ok', true, 'order_id', _order_id, 'order_number', _num, 'reused', _reused,
    'items_total', _items_total, 'delivery_fee', _fee, 'total_amount', _items_total + _fee, 'payment_mode', 'online');
exception when others then
  return jsonb_build_object('ok', false, 'code', split_part(sqlerrm, ':', 1), 'detail', sqlerrm);
end $function$;

-- ---------- A.2 + B.6 merchant credit on delivered ----------
create or replace function public.merchant_orders_ledger_on_complete()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
declare _net numeric; _comm jsonb; _base numeric;
begin
  if NEW.status not in ('completed','delivered') then return NEW; end if;
  if coalesce(OLD.status,'') in ('completed','delivered') then return NEW; end if;

  -- Never credit unpaid, cancelled/rejected, or already-refunded orders.
  if coalesce(NEW.payment_status,'') not in ('paid') then return NEW; end if;
  if coalesce(NEW.refund_status,'none') not in ('none') then return NEW; end if;

  if coalesce(NEW.merchant_net,0) > 0 then
    _net := NEW.merchant_net;
  else
    -- Legacy rows created before the snapshot existed.
    _base := case when NEW.courier_order_id is not null then coalesce(NEW.items_total,0) else coalesce(NEW.total_amount,0) end;
    _comm := public.store_commission_snapshot(NEW.merchant_id, _base);
    _net := (_comm->>'merchant_net')::numeric;
  end if;

  if _net > 0 then
    insert into public.wallet_ledger (owner_type, owner_id, amount, type, reason, wallet_type)
    values ('merchant', NEW.merchant_id, _net, 'credit', 'order:' || NEW.id::text, 'earnings')
    on conflict (owner_type, owner_id, reason) where owner_type = 'merchant' do nothing;
  end if;

  begin
    perform public.evaluate_reward_triggers('merchant', NEW.merchant_id, 'order_completed', NEW.id::text,
      jsonb_build_object('order_id', NEW.id, 'amount', coalesce(NEW.total_amount,0)));
  exception when others then raise warning '[merchant order reward] %', sqlerrm;
  end;

  return NEW;
end $function$;

drop trigger if exists merchant_orders_ledger_on_complete on public.merchant_orders;
create trigger merchant_orders_ledger_on_complete
  after update of status on public.merchant_orders
  for each row execute function public.merchant_orders_ledger_on_complete();

-- ---------- A.2 reversal when a credited order is refunded ----------
create or replace function public.merchant_orders_ledger_reversal()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
declare _credit numeric;
begin
  if coalesce(NEW.refund_status,'none') <> 'done' then return NEW; end if;
  if coalesce(OLD.refund_status,'none') = 'done' then return NEW; end if;

  select amount into _credit from public.wallet_ledger
   where owner_type = 'merchant' and owner_id = NEW.merchant_id
     and reason = 'order:' || NEW.id::text and type = 'credit';
  if _credit is null or _credit <= 0 then return NEW; end if;

  insert into public.wallet_ledger (owner_type, owner_id, amount, type, reason, wallet_type)
  values ('merchant', NEW.merchant_id, _credit, 'debit', 'order_refund_reversal:' || NEW.id::text, 'earnings')
  on conflict (owner_type, owner_id, reason) where owner_type = 'merchant' do nothing;

  return NEW;
end $function$;

drop trigger if exists trg_merchant_orders_ledger_reversal on public.merchant_orders;
create trigger trg_merchant_orders_ledger_reversal
  after update of refund_status on public.merchant_orders
  for each row execute function public.merchant_orders_ledger_reversal();

-- ---------- B.4 default commission at approval ----------
create or replace function public.merchants_default_commission()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if NEW.status = 'approved' and coalesce(OLD.status,'') <> 'approved'
     and coalesce(NEW.commission_value,0) = 0 then
    NEW.commission_type  := 'PERCENTAGE';
    NEW.commission_value := least(greatest(public.store_setting('store_default_commission_pct', 0), 0), 50);
  end if;
  return NEW;
end $function$;

drop trigger if exists trg_merchants_default_commission on public.merchants;
create trigger trg_merchants_default_commission
  before update of status on public.merchants
  for each row execute function public.merchants_default_commission();

-- ---------- B.7 staff sets merchant commission ----------
create or replace function public.staff_set_merchant_commission(_merchant_id uuid, _pct numeric)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare _uid uuid := auth.uid(); _before jsonb; _after jsonb;
begin
  if _uid is null then raise exception 'Not authenticated' using errcode='42501'; end if;
  if not public.is_active_staff(_uid, array['super_admin']) then
    raise exception 'Forbidden' using errcode='42501'; end if;
  if _pct is null or _pct < 0 or _pct > 50 then
    raise exception 'commission_out_of_range' using errcode='22023'; end if;

  select jsonb_build_object('commission_type', m.commission_type, 'commission_value', m.commission_value)
    into _before from public.merchants m where m.id = _merchant_id;
  if _before is null then raise exception 'merchant_not_found'; end if;

  update public.merchants
     set commission_type = 'PERCENTAGE', commission_value = _pct, updated_at = now()
   where id = _merchant_id;

  _after := jsonb_build_object('commission_type', 'PERCENTAGE', 'commission_value', _pct);

  insert into public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  values (_uid, 'set_merchant_commission', 'merchants', _merchant_id, _before, _after);

  return jsonb_build_object('ok', true, 'before', _before, 'after', _after,
    'note', 'Applies to new orders only; existing orders keep their snapshot.');
end $function$;

revoke all on function public.staff_set_merchant_commission(uuid, numeric) from public, anon;
grant execute on function public.staff_set_merchant_commission(uuid, numeric) to authenticated, service_role;

-- ---------- B.8 reporting: tax kept separate from platform revenue ----------
create or replace view public.store_revenue_report as
select
  o.id                                as order_id,
  o.order_number,
  o.merchant_id,
  o.status,
  o.delivered_at,
  o.items_total,
  o.delivery_fee,
  o.total_amount                      as customer_paid,
  o.commission_pct,
  o.commission_amount                 as platform_commission_revenue,
  o.commission_gst_amount             as commission_gst_tax,
  coalesce((o.delivery_quote->>'gst_amount')::numeric, 0) as delivery_gst_tax,
  coalesce((o.delivery_quote->>'platform_fee')::numeric, 0) as delivery_platform_fee_revenue,
  o.commission_amount
    + coalesce((o.delivery_quote->>'platform_fee')::numeric, 0) as platform_revenue_ex_tax,
  o.commission_gst_amount
    + coalesce((o.delivery_quote->>'gst_amount')::numeric, 0)   as total_tax_collected,
  o.merchant_net                      as merchant_payable
from public.merchant_orders o;

revoke all on public.store_revenue_report from public, anon, authenticated;
grant select on public.store_revenue_report to service_role;