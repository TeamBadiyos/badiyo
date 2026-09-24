insert into public.ops_settings(key, value, label) values ('store_unpaid_expiry_minutes','10','Store: cancel unpaid orders after (minutes)') on conflict (key) do nothing;

create or replace function public.store_expire_unpaid() returns integer
language plpgsql security definer set search_path to 'public' as $$
declare _r record; _min int; _n int := 0;
begin
  _min := public.store_setting('store_unpaid_expiry_minutes', 10)::int;
  for _r in select id from public.merchant_orders
             where status = 'pending' and payment_mode = 'online' and coalesce(payment_status,'pending') = 'pending'
               and created_at < now() - make_interval(mins => _min)
             for update skip locked
  loop
    update public.merchant_orders set cancel_reason = 'PAYMENT_NOT_COMPLETED' where id = _r.id;
    perform public.store_set_status(_r.id, 'cancelled', 'store_unpaid_expired', jsonb_build_object('reason','PAYMENT_NOT_COMPLETED'));
    _n := _n + 1;
  end loop;
  return _n;
end $$;
revoke execute on function public.store_expire_unpaid() from public, anon, authenticated;
grant execute on function public.store_expire_unpaid() to service_role;

create or replace function public.store_sweeper() returns void
language plpgsql security definer set search_path to 'public' as $function$
declare _r record; _min int;
begin
  begin
    perform public.store_expire_unpaid();
  exception when others then raise warning 'store_expire_unpaid failed: %', sqlerrm;
  end;
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
end $function$;

create or replace function public.store_attach_payment(_order_id uuid, _rzp_order_id text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare _o record;
begin
  select * into _o from public.merchant_orders where id = _order_id and user_id = auth.uid() for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if coalesce(_o.payment_status,'') = 'paid' then return jsonb_build_object('ok', true); end if;
  if _o.status <> 'pending' or _o.created_at < now() - make_interval(mins => public.store_setting('store_unpaid_expiry_minutes', 10)::int) then
    return jsonb_build_object('ok', false, 'code', 'order_expired');
  end if;
  update public.merchant_orders
     set razorpay_order_id = nullif(btrim(coalesce(_rzp_order_id,'')), ''), updated_at = now()
   where id = _order_id;
  return jsonb_build_object('ok', true);
end $function$;

create or replace function public.store_create_order(_merchant_id uuid, _items jsonb, _address_id uuid, _payment_mode text default 'online', _note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  _uid uuid := auth.uid(); _m record; _addr record; _it jsonb; _p record;
  _qty int; _items_total numeric := 0; _fee numeric; _quote jsonb;
  _order_id uuid; _num text; _count int := 0; _phone text; _name text;
  _want text; _prev record; _reused boolean := false; _exp int;
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

  update public.merchant_orders set items_total = _items_total, delivery_fee = _fee,
         total_amount = _items_total + _fee, updated_at = now() where id = _order_id;
  perform public.store_audit(_order_id, case when _reused then 'store_order_reused' else 'store_order_created' end, null,
    jsonb_build_object('status','pending','total', _items_total + _fee, 'delivery_fee', _fee));

  return jsonb_build_object('ok', true, 'order_id', _order_id, 'order_number', _num, 'reused', _reused,
    'items_total', _items_total, 'delivery_fee', _fee, 'total_amount', _items_total + _fee, 'payment_mode', 'online');
exception when others then
  return jsonb_build_object('ok', false, 'code', split_part(sqlerrm, ':', 1), 'detail', sqlerrm);
end $function$;

create or replace function public.system_store_mark_paid(_rzp_order_id text, _payment_id text)
returns boolean language plpgsql security definer set search_path to 'public' as $function$
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

  -- Payment for an order that is no longer open: never place it, refund, alert admin.
  if _o.status <> 'pending' then
    perform public.store_mark_refund(_o.id,
      case when _o.cancel_reason = 'PAYMENT_NOT_COMPLETED' then 'payment_after_expiry' else 'late_payment' end);
    perform public.store_audit(_o.id, 'store_payment_after_close', jsonb_build_object('status', _o.status),
      jsonb_build_object('refund','queued','payment_id', _payment_id));
    perform public.admin_alert_enqueue('store_late_payment', _o.id,
      'Late payment ' || _o.order_number || ' (auto-refund)', coalesce(_o.customer_name, _o.customer_phone),
      _o.total_amount, to_char(now() at time zone 'Asia/Kolkata', 'DD Mon HH24:MI'));
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
end $function$;

select public.store_expire_unpaid();