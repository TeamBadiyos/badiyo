
-- ============ columns ============
alter table public.merchant_orders
  add column if not exists courier_order_id uuid,
  add column if not exists reject_reason text,
  add column if not exists placed_at timestamptz,
  add column if not exists accepted_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists delivery_quote jsonb,
  add column if not exists needs_attention boolean not null default false,
  add column if not exists refund_status text not null default 'none',
  add column if not exists refund_amount numeric not null default 0,
  add column if not exists refund_id text,
  add column if not exists refund_reason text,
  add column if not exists refund_attempts int not null default 0,
  add column if not exists refund_next_attempt_at timestamptz,
  add column if not exists stock_deducted boolean not null default false;

alter table public.merchant_orders drop constraint if exists merchant_orders_status_check;
alter table public.merchant_orders add constraint merchant_orders_status_check check (status = any (array[
  'pending','paid','placed','accepted','expert_assigned','picked_up','delivered','needs_attention',
  'rejected','preparing','ready','completed','cancelled']));
alter table public.merchant_orders add constraint merchant_orders_refund_status_check
  check (refund_status = any (array['none','refund_pending','processing','done','failed']));

alter table public.courier_orders add column if not exists store_order_id uuid references public.merchant_orders(id);
create unique index if not exists courier_orders_store_order_active_uq
  on public.courier_orders(store_order_id) where store_order_id is not null and status <> 'CANCELLED';

insert into public.ops_settings(key, value, label) values
  ('store_accept_timeout_minutes','5','Store order: minutes the shop has to accept before auto-reject + refund'),
  ('store_courier_road_factor','1.3','Store delivery: road distance factor over straight line')
on conflict (key) do nothing;

-- ============ helpers ============
create or replace function public.store_audit(_order_id uuid, _action text, _before jsonb, _after jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(), _action, 'merchant_orders', _order_id, _before, _after);
exception when others then raise warning 'store_audit failed: %', sqlerrm;
end $$;

create or replace function public.store_set_status(_order_id uuid, _status text, _action text, _extra jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare _old text;
begin
  select status into _old from public.merchant_orders where id = _order_id for update;
  if _old is null or _old = _status then return; end if;
  update public.merchant_orders set status = _status, updated_at = now(),
    accepted_at = case when _status = 'accepted' then coalesce(accepted_at, now()) else accepted_at end,
    delivered_at = case when _status = 'delivered' then coalesce(delivered_at, now()) else delivered_at end,
    placed_at = case when _status = 'placed' then coalesce(placed_at, now()) else placed_at end,
    cancelled_at = case when _status in ('cancelled','rejected') then coalesce(cancelled_at, now()) else cancelled_at end
   where id = _order_id;
  perform public.store_audit(_order_id, _action, jsonb_build_object('status', _old),
    jsonb_build_object('status', _status) || coalesce(_extra, '{}'::jsonb));
end $$;

create or replace function public.store_restock(_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.products p set stock_quantity = coalesce(p.stock_quantity,0) + i.quantity
    from public.merchant_order_items i
   where i.order_id = _order_id and p.id = i.product_id
     and exists (select 1 from public.merchant_orders o where o.id = _order_id and o.stock_deducted);
  update public.merchant_orders set stock_deducted = false where id = _order_id;
end $$;

create or replace function public.store_dispatch_refund_job()
returns void language plpgsql security definer set search_path = public, vault, extensions as $$
declare _secret text;
begin
  if not exists (select 1 from public.merchant_orders where refund_status = 'refund_pending' and refund_amount > 0
                  and (refund_next_attempt_at is null or refund_next_attempt_at <= now())) then return; end if;
  select decrypted_secret into _secret from vault.decrypted_secrets where name = 'courier_job_secret';
  if _secret is null then raise warning 'courier_job_secret missing'; return; end if;
  perform net.http_post(
    url := 'https://user.badiyos.com/api/public/store/process-refunds',
    headers := jsonb_build_object('Content-Type','application/json','x-courier-job-secret', _secret),
    body := '{}'::jsonb);
exception when others then raise warning 'store_dispatch_refund_job failed: %', sqlerrm;
end $$;

create or replace function public.store_mark_refund(_order_id uuid, _reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.merchant_orders
     set refund_status = 'refund_pending', refund_amount = total_amount, refund_reason = _reason,
         refund_next_attempt_at = now(), payment_status = 'refund_pending', updated_at = now()
   where id = _order_id and payment_status = 'paid' and refund_status = 'none';
  if found then
    perform public.store_audit(_order_id, 'store_refund_requested', null, jsonb_build_object('reason', _reason));
    perform public.store_dispatch_refund_job();
  end if;
end $$;

-- ============ fare (same formula as parcel quote) ============
create or replace function public.store_courier_fare(_merchant_id uuid, _drop_lat numeric, _drop_lng numeric)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare _m record; _v record; _t record; _rate public.courier_vehicle_rates%rowtype;
        _km numeric; _base numeric; _sub numeric; _gst_pct numeric; _gst numeric; _total numeric; _key text;
begin
  select id, city, latitude, longitude into _m from public.merchants where id = _merchant_id;
  if _m.id is null or _m.latitude is null or _drop_lat is null then
    return jsonb_build_object('ok', false, 'code', 'delivery_unavailable'); end if;
  _key := lower(trim(coalesce(_m.city,'')));
  -- smallest active two-wheeler with a real rate in this city
  select vt.* into _v from public.courier_vehicle_types vt
    join public.courier_vehicle_rates r on r.vehicle_type_id = vt.id
     and lower(trim(coalesce(r.city,''))) = _key and not r.is_placeholder
   where vt.is_active order by vt.max_weight_kg, vt.sort_order limit 1;
  if _v.id is null then return jsonb_build_object('ok', false, 'code', 'delivery_unavailable'); end if;
  select ct.* into _t from public.courier_types ct
    join public.courier_vehicle_courier_types m on m.courier_type_id = ct.id and m.vehicle_type_id = _v.id and m.is_active
   where ct.is_active order by (lower(ct.name) = 'grocery') desc, (lower(ct.name) = 'other') desc, ct.sort_order limit 1;
  if _t.id is null then return jsonb_build_object('ok', false, 'code', 'delivery_unavailable'); end if;
  select * into _rate from public.courier_vehicle_rates
   where lower(trim(coalesce(city,''))) = _key and vehicle_type_id = _v.id;

  _km := round(public.haversine_km(_m.latitude, _m.longitude, _drop_lat, _drop_lng)
               * coalesce(nullif(public.store_setting('store_courier_road_factor', 1.3),0),1.3), 2);
  if _km > public.store_max_radius_km() * 2 then
    return jsonb_build_object('ok', false, 'code', 'delivery_too_far'); end if;

  _base := round(greatest(_rate.min_fare, _rate.base_fare + greatest(0, _km - _rate.included_km) * _rate.per_km), 2);
  _sub := _base + _t.extra_fee + _rate.platform_fee;
  _gst_pct := public.get_gst_percent();
  _gst := round(_sub * _gst_pct / 100, 2);
  _total := round(_sub + _gst, 0);
  return jsonb_build_object('ok', true, 'city', _m.city, 'vehicle_type_id', _v.id, 'courier_type_id', _t.id,
    'distance_km', _km, 'distance_source', 'haversine', 'base_amount', _base, 'extra_fee', _t.extra_fee,
    'platform_fee', _rate.platform_fee, 'gst_percent', _gst_pct, 'gst_amount', _gst,
    'commission_pct', _rate.commission_pct, 'delivery_fee', _total);
end $$;

create or replace function public.store_quote_delivery(_merchant_id uuid, _address_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare _a record;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'code', 'unauthenticated'); end if;
  select latitude, longitude into _a from public.addresses where id = _address_id and user_id = auth.uid();
  if not found then return jsonb_build_object('ok', false, 'code', 'bad_address'); end if;
  return public.store_courier_fare(_merchant_id, _a.latitude, _a.longitude);
end $$;

-- ============ create order (online only, courier fee) ============
create or replace function public.store_create_order(_merchant_id uuid, _items jsonb, _address_id uuid, _payment_mode text default 'online', _note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  _uid uuid := auth.uid(); _m record; _addr record; _it jsonb; _p record;
  _qty int; _items_total numeric := 0; _fee numeric; _quote jsonb;
  _order_id uuid; _num text; _count int := 0; _phone text; _name text;
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

  select phone, full_name into _phone, _name from public.users where id = _uid;
  _order_id := gen_random_uuid();
  _num := 'BS' || to_char(now() at time zone 'Asia/Kolkata', 'YYMMDD') || lpad((floor(random()*100000))::int::text, 5, '0');

  insert into public.merchant_orders (id, merchant_id, user_id, order_number, status, total_amount,
    address_id, delivery_address, delivery_lat, delivery_lng, customer_phone, customer_name,
    payment_mode, payment_status, items_total, delivery_fee, customer_note, source, delivery_quote)
  values (_order_id, _merchant_id, _uid, _num, 'pending', 0, _address_id,
    nullif(btrim(concat_ws(', ', nullif(_addr.full_address,''), nullif(_addr.area,''), nullif(_addr.city,''))), ''),
    _addr.latitude, _addr.longitude, _phone, _name, 'online', 'pending', 0, 0,
    nullif(btrim(coalesce(_note,'')), ''), 'customer_app', _quote);

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

  update public.merchant_orders set items_total = _items_total, delivery_fee = _fee,
         total_amount = _items_total + _fee, updated_at = now() where id = _order_id;
  perform public.store_audit(_order_id, 'store_order_created', null,
    jsonb_build_object('status','pending','total', _items_total + _fee, 'delivery_fee', _fee));

  return jsonb_build_object('ok', true, 'order_id', _order_id, 'order_number', _num,
    'items_total', _items_total, 'delivery_fee', _fee, 'total_amount', _items_total + _fee, 'payment_mode', 'online');
exception when others then
  return jsonb_build_object('ok', false, 'code', split_part(sqlerrm, ':', 1), 'detail', sqlerrm);
end $$;

-- App-side confirm only records the payment id; webhook is the source of truth.
create or replace function public.store_confirm_payment(_order_id uuid, _rzp_order_id text, _payment_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _o record;
begin
  select * into _o from public.merchant_orders where id = _order_id and user_id = auth.uid();
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if _o.razorpay_order_id is null or _o.razorpay_order_id <> btrim(coalesce(_rzp_order_id,'')) then
    return jsonb_build_object('ok', false, 'code', 'order_mismatch'); end if;
  update public.merchant_orders set razorpay_payment_id = coalesce(razorpay_payment_id, nullif(btrim(coalesce(_payment_id,'')), '')),
         updated_at = now() where id = _order_id;
  return jsonb_build_object('ok', true, 'awaiting_confirmation', coalesce(_o.payment_status,'') <> 'paid');
end $$;

-- Webhook: paid → placed, stock down in the same transaction. Idempotent.
create or replace function public.system_store_mark_paid(_rzp_order_id text, _payment_id text)
returns boolean language plpgsql security definer set search_path = public as $$
declare _o public.merchant_orders%rowtype; _short int;
begin
  select * into _o from public.merchant_orders where razorpay_order_id = btrim(coalesce(_rzp_order_id,'')) for update;
  if _o.id is null then return false; end if;
  if coalesce(_o.payment_status,'') in ('paid','refund_pending','refunded') then return true; end if;

  update public.merchant_orders set payment_status = 'paid',
         razorpay_payment_id = coalesce(nullif(btrim(coalesce(_payment_id,'')), ''), razorpay_payment_id),
         paid_at = coalesce(paid_at, now()), updated_at = now() where id = _o.id;
  perform public.store_audit(_o.id, 'store_payment_confirmed', jsonb_build_object('payment_status', _o.payment_status),
    jsonb_build_object('payment_status','paid','payment_id', _payment_id));

  -- payment for an order that is no longer open: refund
  if _o.status not in ('pending') then
    perform public.store_mark_refund(_o.id, 'late_payment');
    return true;
  end if;

  select count(*) into _short from public.merchant_order_items i join public.products p on p.id = i.product_id
   where i.order_id = _o.id and coalesce(p.stock_quantity,0) < i.quantity;
  if _short > 0 then
    update public.merchant_orders set reject_reason = 'out_of_stock' where id = _o.id;
    perform public.store_set_status(_o.id, 'rejected', 'store_auto_reject_out_of_stock');
    perform public.store_mark_refund(_o.id, 'out_of_stock');
    return true;
  end if;

  update public.products p set stock_quantity = p.stock_quantity - i.quantity
    from public.merchant_order_items i where i.order_id = _o.id and p.id = i.product_id;
  update public.merchant_orders set stock_deducted = true where id = _o.id;
  perform public.store_set_status(_o.id, 'placed', 'store_order_placed');
  return true;
end $$;

-- ============ courier job creation ============
create or replace function public.store_create_courier_job(_order_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare _o public.merchant_orders%rowtype; _m record; _q jsonb; _cid uuid;
begin
  select * into _o from public.merchant_orders where id = _order_id;
  select store_name, owner_name, phone, address, city, latitude, longitude into _m from public.merchants where id = _o.merchant_id;
  _q := coalesce(_o.delivery_quote, public.store_courier_fare(_o.merchant_id, _o.delivery_lat, _o.delivery_lng));
  if not coalesce((_q->>'ok')::boolean, false) then raise exception 'delivery_unavailable'; end if;

  insert into public.courier_orders (customer_id, city, vehicle_type_id, courier_type_id,
    pickup_lat, pickup_lng, pickup_address, pickup_contact_name, pickup_contact_phone,
    drop_lat, drop_lng, drop_address, drop_contact_name, drop_contact_phone,
    package_description, weight_kg, prohibited_items_confirmed, distance_km, distance_source, fare_breakdown,
    quote_expires_at, base_amount, extra_fee, platform_fee, discount_amount, gst_percent, gst_amount,
    total_amount, commission_pct, status, payment_status, store_order_id)
  values (_o.user_id, coalesce(_m.city, _q->>'city'), (_q->>'vehicle_type_id')::uuid, (_q->>'courier_type_id')::uuid,
    _m.latitude, _m.longitude, coalesce(_m.store_name,'Store') || coalesce(', ' || _m.address, ''), _m.store_name, _m.phone,
    _o.delivery_lat, _o.delivery_lng, _o.delivery_address, _o.customer_name, _o.customer_phone,
    'Store order #' || _o.order_number, 0, true, (_q->>'distance_km')::numeric, 'store_quote', _q,
    now() + interval '1 day', coalesce((_q->>'base_amount')::numeric,0), coalesce((_q->>'extra_fee')::numeric,0),
    coalesce((_q->>'platform_fee')::numeric,0), 0, coalesce((_q->>'gst_percent')::numeric,0),
    coalesce((_q->>'gst_amount')::numeric,0), _o.delivery_fee, coalesce((_q->>'commission_pct')::numeric,0),
    'REQUESTED', 'paid', _o.id)
  returning id into _cid;

  update public.merchant_orders set courier_order_id = _cid, needs_attention = false where id = _o.id;
  perform public.store_audit(_o.id, 'store_courier_job_created', null, jsonb_build_object('courier_order_id', _cid));
  perform public.courier_start_dispatch(_cid);
  return _cid;
end $$;

-- ============ merchant accept / reject ============
drop function if exists public.merchant_decide_order(uuid, text);
create or replace function public.merchant_decide_order(_order_id uuid, _decision text, _reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare _merchant_id uuid; _ctx jsonb; _o public.merchant_orders%rowtype;
begin
  _merchant_id := public.current_merchant_id();
  if _merchant_id is null then raise exception 'not_a_merchant'; end if;
  _ctx := public.merchant_my_context();
  if not ((_ctx->>'is_owner')::boolean or _ctx->'permissions' ? 'manage_orders') then raise exception 'not_permitted'; end if;
  if _decision not in ('accepted','rejected') then raise exception 'invalid_decision'; end if;

  select * into _o from public.merchant_orders where id = _order_id and merchant_id = _merchant_id for update;
  if _o.id is null then raise exception 'order_not_found_or_not_pending'; end if;

  -- legacy cash orders keep the old behaviour
  if _o.status = 'pending' and _o.payment_mode = 'cod' then
    perform public.store_set_status(_o.id, _decision, 'merchant_' || _decision, jsonb_build_object('reason', _reason));
    return;
  end if;

  if _o.status not in ('placed','paid') or _o.payment_status <> 'paid' then
    raise exception 'order_not_found_or_not_pending'; end if;

  if _decision = 'rejected' then
    if coalesce(btrim(_reason),'') = '' then raise exception 'reason_required'; end if;
    update public.merchant_orders set reject_reason = btrim(_reason) where id = _o.id;
    perform public.store_set_status(_o.id, 'rejected', 'merchant_rejected', jsonb_build_object('reason', btrim(_reason)));
    perform public.store_restock(_o.id);
    perform public.store_mark_refund(_o.id, 'merchant_rejected');
  else
    perform public.store_set_status(_o.id, 'accepted', 'merchant_accepted');
    perform public.store_create_courier_job(_o.id);
  end if;
end $$;

create or replace function public.merchant_advance_order(_order_id uuid, _new_status text)
returns void language plpgsql security definer set search_path = public as $$
declare _merchant_id uuid; _ctx jsonb; _current text; _courier uuid; _ok boolean;
begin
  _merchant_id := public.current_merchant_id();
  if _merchant_id is null then raise exception 'not_a_merchant'; end if;
  _ctx := public.merchant_my_context();
  if not ((_ctx->>'is_owner')::boolean or _ctx->'permissions' ? 'manage_orders') then raise exception 'not_permitted'; end if;
  select status, courier_order_id into _current, _courier from public.merchant_orders
   where id = _order_id and merchant_id = _merchant_id;
  if _current is null then raise exception 'order_not_found'; end if;
  if _courier is not null then
    -- delivery status is owned by the Expert; only the delivery code can finish these orders
    raise exception 'delivery_managed_by_expert';
  end if;
  _ok := (_new_status = 'preparing' and _current = 'accepted') or (_new_status = 'ready' and _current = 'preparing')
      or (_new_status = 'completed' and _current = 'ready');
  if not _ok then raise exception 'invalid_transition'; end if;
  perform public.store_set_status(_order_id, _new_status, 'merchant_' || _new_status);
end $$;

-- ============ OTP read paths (reuse courier OTP) ============
create or replace function public.merchant_get_pickup_otp(_order_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _mid uuid; _cid uuid; _c record; _s record;
begin
  _mid := public.current_merchant_id();
  if _mid is null then raise exception 'not_a_merchant' using errcode='42501'; end if;
  select courier_order_id into _cid from public.merchant_orders where id = _order_id and merchant_id = _mid;
  if _cid is null then raise exception 'no_delivery_job'; end if;
  select status into _c from public.courier_orders where id = _cid;
  if _c.status <> 'ARRIVED_PICKUP' then
    return jsonb_build_object('ok', false, 'reason', 'not_arrived', 'courier_status', _c.status); end if;
  select * into _s from public.courier_order_secrets where order_id = _cid;
  if _s.pickup_otp_issued_at is null or _s.pickup_otp_expires_at < now() then
    return jsonb_build_object('ok', true, 'otp', public.courier_issue_otp(_cid, 'pickup'));
  end if;
  return jsonb_build_object('ok', true, 'otp', public.courier_derive_otp(_cid, 'pickup', _s.pickup_otp_issued_at));
end $$;

create or replace function public.store_get_delivery_otp(_order_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _cid uuid;
begin
  select courier_order_id into _cid from public.merchant_orders where id = _order_id and user_id = auth.uid();
  if _cid is null then raise exception 'Forbidden' using errcode='42501'; end if;
  return public.courier_get_otp(_cid, 'delivery');
end $$;

-- ============ courier → store status sync ============
create or replace function public.store_sync_from_courier()
returns trigger language plpgsql security definer set search_path = public as $$
declare _cur text;
begin
  if NEW.store_order_id is null or NEW.status is not distinct from OLD.status then return NEW; end if;
  select status into _cur from public.merchant_orders where id = NEW.store_order_id;
  if _cur in ('rejected','cancelled','delivered','completed') then return NEW; end if;
  if NEW.status = 'DRIVER_ASSIGNED' then
    perform public.store_set_status(NEW.store_order_id, 'expert_assigned', 'courier_expert_assigned', jsonb_build_object('expert_id', NEW.assigned_expert_id));
    update public.merchant_orders set needs_attention = false where id = NEW.store_order_id;
  elsif NEW.status = 'SEARCHING' and OLD.status in ('DRIVER_ASSIGNED','ARRIVED_PICKUP') then
    perform public.store_set_status(NEW.store_order_id, 'accepted', 'courier_expert_released');
  elsif NEW.status = 'PICKED_UP' then
    perform public.store_set_status(NEW.store_order_id, 'picked_up', 'courier_pickup_otp_verified');
  elsif NEW.status = 'DELIVERED' then
    perform public.store_set_status(NEW.store_order_id, 'delivered', 'courier_delivery_otp_verified');
  elsif NEW.status in ('CANCELLED','FAILED_DELIVERY') then
    update public.merchant_orders set needs_attention = true where id = NEW.store_order_id;
    perform public.store_set_status(NEW.store_order_id, 'needs_attention', 'courier_' || lower(NEW.status),
      jsonb_build_object('reason', NEW.cancel_reason_code));
    perform public.admin_alert_enqueue('store_attention', NEW.store_order_id, 'Store delivery problem', null, NEW.total_amount, 'Now');
  end if;
  return NEW;
end $$;
drop trigger if exists trg_store_sync_from_courier on public.courier_orders;
create trigger trg_store_sync_from_courier after update of status on public.courier_orders
  for each row execute function public.store_sync_from_courier();

-- Only the Expert delivery-code path may mark a courier-linked store order delivered.
create or replace function public.store_guard_delivered()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.status in ('delivered','completed') and OLD.status is distinct from NEW.status and NEW.courier_order_id is not null
     and not exists (select 1 from public.courier_orders c where c.id = NEW.courier_order_id and c.status in ('DELIVERED','COMPLETED')) then
    raise exception 'delivery_code_required';
  end if;
  return NEW;
end $$;
drop trigger if exists trg_store_guard_delivered on public.merchant_orders;
create trigger trg_store_guard_delivered before update of status on public.merchant_orders
  for each row execute function public.store_guard_delivered();

-- Parcel "paid" alert should not fire for store delivery jobs.
create or replace function public.admin_alert_on_courier_paid()
returns trigger language plpgsql security definer set search_path = public as $$
declare _name text; _vehicle text; _amount numeric;
begin
  if NEW.store_order_id is not null then return NEW; end if;
  if not public.admin_alert_enabled('admin_whatsapp_alert_enabled') then return NEW; end if;
  select u.full_name into _name from public.users u where u.id = NEW.customer_id;
  select vt.name into _vehicle from public.courier_vehicle_types vt where vt.id = NEW.vehicle_type_id;
  _amount := coalesce(nullif(NEW.total_amount, 0), NEW.base_amount + coalesce(NEW.gst_amount, 0), NEW.base_amount);
  perform public.admin_alert_enqueue('courier', NEW.id, 'Local Parcel - ' || coalesce(_vehicle, 'Bike'), _name, _amount, 'Now');
  return NEW;
exception when others then raise warning 'admin_alert_on_courier_paid failed: %', sqlerrm; return NEW;
end $$;

-- Merchant push + admin alert fire when an order is placed (paid), not when created unpaid.
drop trigger if exists trg_notify_merchant_new_order on public.merchant_orders;
create or replace function public.notify_merchant_new_order()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare _base text := 'https://project--981f7dd4-309e-4614-b96b-67bc34bd1fdd.lovable.app'; _secret text; _store text;
begin
  begin
    if new.merchant_id is null then return new; end if;
    if not ((new.status = 'placed') or (new.status = 'pending' and new.payment_mode = 'cod')) then return new; end if;
    if tg_op = 'UPDATE' and old.status is not distinct from new.status then return new; end if;
    select value into _secret from public.edge_runtime_config where key = 'push_trigger_secret';
    if _secret is null or _secret = '' then return new; end if;
    select store_name into _store from public.merchants where id = new.merchant_id;
    perform net.http_post(url := _base || '/api/public/merchant-send-push',
      headers := jsonb_build_object('content-type','application/json','x-trigger-secret', _secret),
      body := jsonb_build_object('order_id', new.id, 'merchant_id', new.merchant_id, 'alert_type', 'new_order',
        'title', 'New order ' || coalesce(new.order_number, ''),
        'body', 'New order at ' || coalesce(_store, 'your store') || ' — tap to accept.',
        'amount', new.total_amount, 'timeout_seconds', 45));
  exception when others then raise warning '[notify_merchant_new_order] failed for order %: %', new.id, sqlerrm;
  end;
  return new;
end $$;
create trigger trg_notify_merchant_new_order after insert or update of status on public.merchant_orders
  for each row execute function public.notify_merchant_new_order();

drop trigger if exists admin_alert_merchant_paid_ins on public.merchant_orders;
drop trigger if exists admin_alert_merchant_paid_upd on public.merchant_orders;
create trigger admin_alert_merchant_paid_ins after insert on public.merchant_orders for each row
  when (new.status = any (array['paid','confirmed','placed'])) execute function public.admin_alert_on_merchant_paid();
create trigger admin_alert_merchant_paid_upd after update on public.merchant_orders for each row
  when (old.status is distinct from new.status and new.status = any (array['paid','confirmed','placed']))
  execute function public.admin_alert_on_merchant_paid();

-- Customer pushes for the new statuses.
create or replace function public.notify_customer_order_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare _title text; _body text; _store text;
begin
  if NEW.status is not distinct from OLD.status then return NEW; end if;
  if NEW.user_id is null then return NEW; end if;
  select store_name into _store from public.merchants where id = NEW.merchant_id;
  _store := coalesce(_store, 'the store');
  if NEW.status = 'placed' then _title := 'Order placed'; _body := 'Payment received. Waiting for ' || _store || ' to accept.';
  elsif NEW.status = 'accepted' then _title := 'Order accepted'; _body := _store || ' accepted your order. Finding a delivery partner.';
  elsif NEW.status = 'expert_assigned' then _title := 'Delivery partner assigned'; _body := 'A delivery partner is heading to ' || _store || '.';
  elsif NEW.status = 'picked_up' then _title := 'Order picked up'; _body := 'Your order is on the way. Share your delivery code at the door.';
  elsif NEW.status = 'delivered' then _title := 'Order delivered'; _body := 'Your order from ' || _store || ' has been delivered.';
  elsif NEW.status = 'preparing' then _title := 'Order being prepared'; _body := _store || ' is preparing your order.';
  elsif NEW.status = 'ready' then _title := 'Order ready'; _body := 'Your order from ' || _store || ' is ready.';
  elsif NEW.status = 'completed' then _title := 'Order completed'; _body := 'Your order from ' || _store || ' is complete.';
  elsif NEW.status = 'rejected' then _title := 'Order declined'; _body := _store || ' could not accept your order. Your payment will be refunded in full.';
  elsif NEW.status = 'cancelled' then _title := 'Order cancelled'; _body := 'Your order was cancelled. Any payment will be refunded in full.';
  else return NEW; end if;
  perform public.notify_push_event('customer', NEW.user_id, 'order_' || NEW.status, _title, _body,
    jsonb_build_object('order_id', NEW.id, 'route', 'my-orders', 'status', NEW.status));
  return NEW;
end $$;

-- Merchant earnings: for Expert-delivered orders the delivery fee is the rider's, not the shop's.
create or replace function public.merchant_orders_ledger_on_complete()
returns trigger language plpgsql security definer set search_path = public as $$
declare _net numeric;
begin
  if NEW.status in ('completed','delivered') and coalesce(OLD.status,'') not in ('completed','delivered') then
    _net := (case when NEW.courier_order_id is not null then coalesce(NEW.items_total,0) else coalesce(NEW.total_amount,0) end)
            - coalesce(NEW.commission_amount,0);
    insert into public.wallet_ledger (owner_type, owner_id, amount, type, reason)
    values ('merchant', NEW.merchant_id, abs(_net), case when _net < 0 then 'debit' else 'credit' end, 'order:' || NEW.id::text)
    on conflict do nothing;
    begin
      perform public.evaluate_reward_triggers('merchant', NEW.merchant_id, 'order_completed', NEW.id::text,
        jsonb_build_object('order_id', NEW.id, 'amount', coalesce(NEW.total_amount,0)));
    exception when others then raise warning '[merchant order reward] %', sqlerrm;
    end;
  end if;
  return NEW;
end $$;

-- ============ sweepers ============
create or replace function public.store_sweeper()
returns void language plpgsql security definer set search_path = public as $$
declare _r record; _min int;
begin
  begin
    _min := public.store_setting('store_accept_timeout_minutes', 5)::int;
    for _r in select id from public.merchant_orders
               where status in ('placed','paid') and payment_status = 'paid'
                 and coalesce(placed_at, paid_at, created_at) < now() - make_interval(mins => _min)
    loop
      update public.merchant_orders set reject_reason = 'Shop did not accept in time' where id = _r.id;
      perform public.store_set_status(_r.id, 'rejected', 'store_auto_reject_timeout');
      perform public.store_restock(_r.id);
      perform public.store_mark_refund(_r.id, 'merchant_timeout');
    end loop;
    perform public.store_dispatch_refund_job();
  exception when others then raise warning 'store_sweeper failed: %', sqlerrm;
  end;
end $$;

create or replace function public.courier_sweeper()
returns void language plpgsql security definer set search_path = public as $$
declare _r record; _timeout int; _expire int; _delay int; _step numeric; _max numeric;
begin
  begin
    _timeout := public.courier_setting('courier_search_timeout_minutes', 5)::int;
    _expire  := public.courier_setting('courier_unpaid_expire_minutes', 15)::int;
    _delay   := public.courier_setting('courier_settlement_delay_minutes', 0)::int;
    select coalesce(radius_expand_step_km,1), coalesce(radius_expand_max_km,10) into _step, _max from public.dispatch_config limit 1;
    _step := coalesce(_step,1); _max := coalesce(_max,10);

    update public.courier_offers set status='expired', responded_at=now() where status='pending' and expires_at <= now();

    for _r in select id, customer_id from public.courier_orders
               where status='REQUESTED' and payment_status='pending' and created_at < now() - make_interval(mins => _expire)
    loop
      perform set_config('app.courier_actor_type','system',true);
      update public.courier_orders set status='CANCELLED', cancelled_by='system', cancelled_at=now(), cancel_reason_code='unpaid_expired' where id=_r.id;
    end loop;

    for _r in select id, customer_id, search_started_at, current_search_radius_km, store_order_id, needs_ops_attention, total_amount
                from public.courier_orders where status='SEARCHING'
    loop
      if _r.search_started_at is not null and _r.search_started_at < now() - make_interval(mins => _timeout)
         and _r.store_order_id is not null then
        -- store delivery: never auto-cancel; alert admin once and keep searching
        if not coalesce(_r.needs_ops_attention,false) then
          update public.courier_orders set needs_ops_attention = true where id = _r.id;
          update public.merchant_orders set needs_attention = true where id = _r.store_order_id;
          perform public.store_audit(_r.store_order_id, 'store_no_expert_found', null, jsonb_build_object('courier_order_id', _r.id));
          perform public.admin_alert_enqueue('store_no_expert', _r.store_order_id, 'Store order - no Expert found', null, _r.total_amount, 'Now');
        end if;
        if not exists (select 1 from public.courier_offers where order_id=_r.id and status='pending' and expires_at > now()) then
          perform public.courier_dispatch_next(_r.id);
        end if;
      elsif _r.search_started_at is not null and _r.search_started_at < now() - make_interval(mins => _timeout) then
        perform set_config('app.courier_actor_type','system',true);
        update public.courier_orders set status='CANCELLED', cancelled_by='system', cancelled_at=now(), cancel_reason_code='no_rider_found' where id=_r.id;
        update public.courier_offers set status='cancelled' where order_id=_r.id and status='pending';
        perform public.courier_mark_refund_pending(_r.id, (select total_amount from public.courier_orders where id=_r.id), 'no_rider_found');
        perform public.notify_customer_user_push(_r.customer_id, 'No rider available', 'We could not find a rider. Your payment is being refunded.', 'home');
      else
        if not exists (select 1 from public.courier_offers where order_id=_r.id and status='pending' and expires_at > now()) then
          update public.courier_orders set current_search_radius_km = least(_max, coalesce(current_search_radius_km, 5) + _step) where id=_r.id;
          perform public.courier_dispatch_next(_r.id);
        end if;
      end if;
    end loop;

    for _r in select id from public.courier_orders
               where status='DELIVERED' and earnings_credited_at is null and delivered_at < now() - make_interval(mins => _delay)
    loop
      perform set_config('app.courier_actor_type','system',true);
      perform public.courier_settle_order(_r.id);
    end loop;
  exception when others then raise warning 'courier_sweeper failed: %', sqlerrm;
  end;
  perform public.store_sweeper();
end $$;

-- ============ staff actions ============
create or replace function public.staff_store_reassign(_order_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _o public.merchant_orders%rowtype; _c record;
begin
  if not public.is_active_staff(auth.uid(), array['super_admin','ops_manager']) then raise exception 'Forbidden' using errcode='42501'; end if;
  select * into _o from public.merchant_orders where id = _order_id for update;
  if _o.id is null or _o.payment_status <> 'paid' then raise exception 'order_not_reassignable'; end if;
  select id, status into _c from public.courier_orders where id = _o.courier_order_id;
  if _c.id is null or _c.status = 'CANCELLED' then
    perform public.store_set_status(_o.id, 'accepted', 'staff_store_reassign');
    perform public.store_create_courier_job(_o.id);
  elsif _c.status = 'SEARCHING' then
    update public.courier_orders set search_started_at = now(), needs_ops_attention = false,
      current_search_radius_km = (select broadcast_radius_km from public.dispatch_config limit 1) where id = _c.id;
    update public.merchant_orders set needs_attention = false where id = _o.id;
    perform public.store_audit(_o.id, 'staff_store_reassign', null, jsonb_build_object('courier_order_id', _c.id));
    perform public.courier_dispatch_next(_c.id);
  else
    raise exception 'order_not_reassignable';
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.staff_store_cancel_refund(_order_id uuid, _reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _o public.merchant_orders%rowtype; _c record;
begin
  if not public.is_active_staff(auth.uid(), array['super_admin','ops_manager']) then raise exception 'Forbidden' using errcode='42501'; end if;
  if coalesce(btrim(_reason),'') = '' then raise exception 'reason_required'; end if;
  select * into _o from public.merchant_orders where id = _order_id for update;
  if _o.id is null or _o.status in ('delivered','completed','cancelled','rejected') then raise exception 'order_not_cancellable'; end if;
  select id, status into _c from public.courier_orders where id = _o.courier_order_id;
  if _c.id is not null and _c.status in ('REQUESTED','SEARCHING','DRIVER_ASSIGNED','ARRIVED_PICKUP') then
    perform set_config('app.courier_actor_type','staff',true);
    update public.courier_orders set status='CANCELLED', cancelled_by='staff', cancelled_at=now(), cancel_reason_code='store_order_cancelled' where id=_c.id;
    update public.courier_offers set status='cancelled' where order_id=_c.id and status='pending';
  end if;
  update public.merchant_orders set cancel_reason = btrim(_reason), needs_attention = false where id = _o.id;
  perform public.store_set_status(_o.id, 'cancelled', 'staff_store_cancel_refund', jsonb_build_object('reason', btrim(_reason)));
  if _c.id is null or _c.status in ('REQUESTED','SEARCHING','DRIVER_ASSIGNED','ARRIVED_PICKUP','CANCELLED') then
    perform public.store_restock(_o.id);
  end if;
  perform public.store_mark_refund(_o.id, 'staff_cancelled');
  return jsonb_build_object('ok', true);
end $$;

-- ============ permissions ============
revoke all on function public.store_audit(uuid,text,jsonb,jsonb), public.store_set_status(uuid,text,text,jsonb),
  public.store_restock(uuid), public.store_dispatch_refund_job(), public.store_mark_refund(uuid,text),
  public.store_courier_fare(uuid,numeric,numeric), public.store_create_courier_job(uuid), public.store_sweeper(),
  public.system_store_mark_paid(text,text), public.store_sync_from_courier(), public.store_guard_delivered()
  from public, anon, authenticated;
grant execute on function public.store_sweeper(), public.system_store_mark_paid(text,text),
  public.store_dispatch_refund_job() to service_role;
revoke all on function public.store_quote_delivery(uuid,uuid), public.store_create_order(uuid,jsonb,uuid,text,text),
  public.store_confirm_payment(uuid,text,text), public.merchant_decide_order(uuid,text,text),
  public.merchant_advance_order(uuid,text), public.merchant_get_pickup_otp(uuid), public.store_get_delivery_otp(uuid),
  public.staff_store_reassign(uuid), public.staff_store_cancel_refund(uuid,text) from public, anon;
grant execute on function public.store_quote_delivery(uuid,uuid), public.store_create_order(uuid,jsonb,uuid,text,text),
  public.store_confirm_payment(uuid,text,text), public.merchant_decide_order(uuid,text,text),
  public.merchant_advance_order(uuid,text), public.merchant_get_pickup_otp(uuid), public.store_get_delivery_otp(uuid),
  public.staff_store_reassign(uuid), public.staff_store_cancel_refund(uuid,text) to authenticated, service_role;

-- Old unpaid online orders stuck at 'paid' are treated as placed going forward (none today).
update public.merchant_orders set status = 'placed', placed_at = coalesce(paid_at, now())
 where status = 'paid' and payment_status = 'paid';
