-- Fix 1: business_requeue_order passed 4 args to business_audit (needs 6)
create or replace function public.business_requeue_order(_order_id uuid, _actor_label text default null::text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare _mid uuid := public.business_require_delivery(); _o public.business_orders%rowtype; _new uuid;
begin
  select * into _o from public.business_orders where id=_order_id and merchant_id=_mid for update;
  if _o.id is null then raise exception 'Order not found'; end if;
  if _o.status not in ('failed','returned') then raise exception 'Only failed or returned orders can be sent again'; end if;
  if exists (select 1 from public.business_orders where requeued_from_id=_o.id) then
    raise exception 'This order was already sent again'; end if;
  insert into public.business_orders (merchant_id, receiver_id, pickup_point_id, reference_no, description, packet_count,
                                      status, created_by_label, requeued_from_id)
  values (_o.merchant_id, _o.receiver_id, _o.pickup_point_id, _o.reference_no, _o.description, _o.packet_count,
          'pending', left(_actor_label,120), _o.id)
  returning id into _new;
  perform public.business_audit(
    'business_requeue_order',
    'business_orders',
    _new,
    to_jsonb(_o),
    jsonb_build_object('from', _o.id, 'new_order_id', _new),
    _actor_label
  );
  return _new;
end $$;

-- Fix 2: business_create_topup_intent passed 7 args to business_audit (needs 6)
create or replace function public.business_create_topup_intent(_amount numeric, _razorpay_order_id text, _actor_label text default null::text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
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

  perform public.business_audit(
    'business_create_topup_intent',
    'business_wallet_topups',
    _id,
    null,
    jsonb_build_object('merchant_id', _mid, 'amount', _amount, 'razorpay_order_id', btrim(_razorpay_order_id)),
    _actor_label
  );

  return _id;
end $$;