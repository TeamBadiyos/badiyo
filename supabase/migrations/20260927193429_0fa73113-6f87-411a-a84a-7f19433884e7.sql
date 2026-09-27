
-- ========== 1. Code helpers ==========
create or replace function public.seal_luhn_digit(_serial6 text) returns int
language plpgsql immutable set search_path to 'public' as $$
declare _s int := 0; _i int; _d int; _len int := length(_serial6);
begin
  for _i in 0.._len-1 loop
    _d := substr(_serial6, _len - _i, 1)::int;
    if _i % 2 = 0 then _d := _d * 2; if _d > 9 then _d := _d - 9; end if; end if;
    _s := _s + _d;
  end loop;
  return (10 - (_s % 10)) % 10;
end $$;

create or replace function public.seal_code_for_serial(_serial int) returns text
language sql immutable set search_path to 'public' as $$
  select lpad(_serial::text,6,'0') || public.seal_luhn_digit(lpad(_serial::text,6,'0'))::text $$;

create or replace function public.seal_code_normalize(_raw text) returns text
language plpgsql immutable set search_path to 'public' as $$
declare _s text := upper(regexp_replace(coalesce(_raw,''), '[\s\-]', '', 'g'));
begin
  if left(_s,3) = 'BDY' then _s := substr(_s,4); end if;
  if _s ~ '^[0-9]{7}$' then return _s; end if;
  return null;
end $$;

create or replace function public.seal_luhn_ok(_raw text) returns boolean
language plpgsql immutable set search_path to 'public' as $$
declare _c text := public.seal_code_normalize(_raw);
begin
  if _c is null then return false; end if;
  return public.seal_luhn_digit(left(_c,6)) = substr(_c,7,1)::int;
end $$;

create or replace function public.seal_printed_text(_code text) returns text
language sql immutable set search_path to 'public' as $$
  select case when _code ~ '^[0-9]{7}$' then 'BDY ' || left(_code,6) || '-' || right(_code,1) end $$;

-- ========== 2. Tables ==========
create table public.business_seal_batches (
  id uuid primary key default gen_random_uuid(),
  batch_no serial unique,
  serial_from int not null,
  serial_to int not null,
  merchant_id uuid null references public.merchants(id),
  assigned_at timestamptz,
  charge_amount numeric not null default 0,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (serial_from between 1 and 999999 and serial_to between serial_from and 999999)
);
grant select on public.business_seal_batches to authenticated;
grant all on public.business_seal_batches to service_role;
alter table public.business_seal_batches enable row level security;
create policy "Ops and owning business read seal batches" on public.business_seal_batches for select to authenticated
  using (public.courier_is_ops_staff() or (merchant_id = public.current_merchant_id() and public.merchant_caller_has_perm('manage_delivery')));

create table public.business_seal_stickers (
  code text primary key check (code ~ '^[0-9]{7}$'),
  serial int not null unique,
  batch_id uuid not null references public.business_seal_batches(id),
  merchant_id uuid null references public.merchants(id),
  status text not null default 'unassigned' check (status in ('unassigned','available','used','void')),
  business_order_id uuid null unique references public.business_orders(id),
  entry_method text null check (entry_method in ('scan','manual')),
  used_at timestamptz, voided_at timestamptz, void_reason text
);
create index business_seal_stickers_merchant_status on public.business_seal_stickers(merchant_id, status);
grant select on public.business_seal_stickers to authenticated;
grant all on public.business_seal_stickers to service_role;
alter table public.business_seal_stickers enable row level security;
create policy "Ops and owning business read stickers" on public.business_seal_stickers for select to authenticated
  using (public.courier_is_ops_staff() or (merchant_id = public.current_merchant_id() and public.merchant_caller_has_perm('manage_delivery')));

alter table public.business_orders
  add column seal_code text null unique references public.business_seal_stickers(code),
  add column entry_method text null check (entry_method in ('scan','manual'));
alter table public.business_trip_packets
  add column pickup_entry_method text null check (pickup_entry_method in ('scan','manual')),
  add column drop_entry_method text null check (drop_entry_method in ('scan','manual'));
alter table public.bulk_pricing_plans
  add column drop_count_basis text not null default 'packet' check (drop_count_basis in ('packet','shop'));

-- ========== 3. Staff RPCs ==========
create or replace function public.staff_seal_create_batch(_serial_from int, _serial_to int, _notes text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _id uuid; _n int; _no int;
begin
  perform public.business_require_ops();
  if _serial_from is null or _serial_to is null or _serial_from < 1 or _serial_to > 999999 or _serial_to < _serial_from then
    raise exception 'INVALID_RANGE'; end if;
  if _serial_to - _serial_from + 1 > 50000 then raise exception 'MAX_50000_PER_BATCH'; end if;
  lock table public.business_seal_batches in share row exclusive mode;
  if exists (select 1 from public.business_seal_batches where serial_from <= _serial_to and serial_to >= _serial_from) then
    raise exception 'RANGE_OVERLAP'; end if;
  insert into public.business_seal_batches(serial_from, serial_to, notes, created_by)
  values (_serial_from, _serial_to, nullif(btrim(coalesce(_notes,'')),''), auth.uid()) returning id, batch_no into _id, _no;
  insert into public.business_seal_stickers(code, serial, batch_id)
  select public.seal_code_for_serial(g), g, _id from generate_series(_serial_from, _serial_to) g;
  get diagnostics _n = row_count;
  perform public.business_audit('staff_seal_create_batch','business_seal_batches',_id,null,
    jsonb_build_object('batch_no',_no,'serial_from',_serial_from,'serial_to',_serial_to,'count',_n),'staff');
  return jsonb_build_object('batch_id',_id,'batch_no',_no,'count',_n);
end $$;

create or replace function public.staff_seal_assign_batch(_batch_id uuid, _merchant_id uuid, _charge_amount numeric default 0)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _b public.business_seal_batches%rowtype; _n int;
begin
  perform public.business_require_ops();
  select * into _b from public.business_seal_batches where id=_batch_id for update;
  if _b.id is null then raise exception 'BATCH_NOT_FOUND'; end if;
  if _b.merchant_id is not null then raise exception 'BATCH_ALREADY_ASSIGNED'; end if;
  if not exists (select 1 from public.merchants where id=_merchant_id) then raise exception 'BUSINESS_NOT_FOUND'; end if;
  if coalesce(_charge_amount,0) < 0 then raise exception 'INVALID_CHARGE'; end if;
  if coalesce(_charge_amount,0) > 0 then
    begin
      perform public.business_wallet_post(_merchant_id,'debit',_charge_amount,'Seal stickers batch #'||_b.batch_no,false,auth.uid());
    exception when others then
      if sqlerrm like '%INSUFFICIENT_WALLET%' then raise exception 'INSUFFICIENT_WALLET'; end if;
      raise;
    end;
  end if;
  update public.business_seal_batches set merchant_id=_merchant_id, assigned_at=now(), charge_amount=coalesce(_charge_amount,0) where id=_batch_id;
  update public.business_seal_stickers set merchant_id=_merchant_id, status='available' where batch_id=_batch_id and status='unassigned';
  get diagnostics _n = row_count;
  perform public.business_audit('staff_seal_assign_batch','business_seal_batches',_batch_id,to_jsonb(_b),
    jsonb_build_object('merchant_id',_merchant_id,'charge_amount',coalesce(_charge_amount,0),'stickers',_n),'staff');
  return jsonb_build_object('ok',true,'stickers',_n);
end $$;

create or replace function public.staff_seal_void(_code text, _reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _c text := public.seal_code_normalize(_code); _s public.business_seal_stickers%rowtype; _ost text;
begin
  perform public.business_require_ops();
  if coalesce(btrim(_reason),'') = '' then raise exception 'A reason is required'; end if;
  select * into _s from public.business_seal_stickers where code=_c for update;
  if _s.code is null then raise exception 'NOT_FOUND'; end if;
  if _s.business_order_id is not null then
    select status into _ost from public.business_orders where id=_s.business_order_id;
    if _ost in ('in_transit','delivered','returned','failed') then raise exception 'ALREADY_PICKED_UP'; end if;
  end if;
  update public.business_seal_stickers set status='void', voided_at=now(), void_reason=btrim(_reason) where code=_c;
  perform public.business_audit('staff_seal_void','business_seal_stickers',null,to_jsonb(_s),
    jsonb_build_object('code',_c,'reason',btrim(_reason)),'staff');
  return jsonb_build_object('ok',true,'code',_c);
end $$;

create or replace function public.staff_seal_batch_export(_batch_id uuid)
returns table(serial int, code text, qr_payload text, printed_text text)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform public.business_require_ops();
  return query select s.serial, s.code, 'BDY'||s.code, public.seal_printed_text(s.code)
    from public.business_seal_stickers s where s.batch_id=_batch_id order by s.serial;
end $$;

create or replace function public.staff_seal_lookup(_raw text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare _c text := public.seal_code_normalize(_raw); _s public.business_seal_stickers%rowtype;
begin
  perform public.business_require_ops();
  if _c is null then return jsonb_build_object('ok',false,'error','INVALID_FORMAT'); end if;
  select * into _s from public.business_seal_stickers where code=_c;
  if _s.code is null then return jsonb_build_object('ok',false,'error','NOT_FOUND','code',_c); end if;
  return jsonb_build_object('ok',true,'code',_s.code,'printed_text',public.seal_printed_text(_s.code),
    'status',_s.status,'entry_method',_s.entry_method,'used_at',_s.used_at,'voided_at',_s.voided_at,'void_reason',_s.void_reason,
    'batch',(select jsonb_build_object('id',b.id,'batch_no',b.batch_no) from public.business_seal_batches b where b.id=_s.batch_id),
    'business',(select jsonb_build_object('id',m.id,'name',m.store_name) from public.merchants m where m.id=_s.merchant_id),
    'order',(select jsonb_build_object('id',o.id,'display_no',left(o.id::text,8),'receiver_name',r.name,'status',o.status,'created_at',o.created_at)
             from public.business_orders o left join public.business_receivers r on r.id=o.receiver_id where o.id=_s.business_order_id));
end $$;

-- ========== 4. Business RPCs ==========
create or replace function public.business_seal_validate(_mid uuid, _raw text, _lock boolean)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _c text := public.seal_code_normalize(_raw); _s public.business_seal_stickers%rowtype; _d jsonb;
begin
  if _c is null then return jsonb_build_object('ok',false,'code',null,'error','INVALID_FORMAT'); end if;
  if not public.seal_luhn_ok(_c) then return jsonb_build_object('ok',false,'code',_c,'error','BAD_CHECK_DIGIT'); end if;
  if _lock then select * into _s from public.business_seal_stickers where code=_c for update;
  else select * into _s from public.business_seal_stickers where code=_c; end if;
  if _s.code is null then return jsonb_build_object('ok',false,'code',_c,'error','NOT_FOUND'); end if;
  if _s.merchant_id is distinct from _mid or _s.status = 'unassigned' then
    return jsonb_build_object('ok',false,'code',_c,'error','NOT_YOURS'); end if;
  if _s.status = 'void' then return jsonb_build_object('ok',false,'code',_c,'error','VOID'); end if;
  if _s.status = 'used' then
    select jsonb_build_object('order_id',o.id,'display_no',left(o.id::text,8),'receiver_name',r.name,'date',o.created_at) into _d
      from public.business_orders o left join public.business_receivers r on r.id=o.receiver_id where o.id=_s.business_order_id;
    return jsonb_build_object('ok',false,'code',_c,'error','ALREADY_USED','detail',_d);
  end if;
  return jsonb_build_object('ok',true,'code',_c,'error',null);
end $$;

create or replace function public.business_seal_check(_merchant_id uuid, _raw text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if _merchant_id is distinct from public.current_merchant_id() or not public.merchant_caller_has_perm('manage_delivery') then
    raise exception 'Forbidden' using errcode='42501'; end if;
  return public.business_seal_validate(_merchant_id, _raw, false);
end $$;

create or replace function public.business_create_packet_orders(_merchant_id uuid, _receiver_id uuid, _pickup_point_id uuid,
  _codes text[], _entry_methods text[], _actor_label text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _mid uuid := public.business_require_delivery(); _i int; _n int := coalesce(array_length(_codes,1),0);
  _norm text[] := '{}'; _em text; _v jsonb; _fails jsonb := '[]'::jsonb; _ids uuid[] := '{}'; _oid uuid; _c text;
begin
  if _merchant_id is distinct from _mid then raise exception 'Forbidden' using errcode='42501'; end if;
  if _n = 0 then raise exception 'At least one code is required'; end if;
  if _n > 50 then raise exception 'Max 50 codes per call'; end if;
  for _i in 1.._n loop
    _em := coalesce(_entry_methods[_i],'scan');
    if _em not in ('scan','manual') then
      _fails := _fails || jsonb_build_object('index',_i,'input',_codes[_i],'error','INVALID_ENTRY_METHOD'); continue; end if;
    _c := public.seal_code_normalize(_codes[_i]);
    if _c is not null and _c = any(_norm) then
      _fails := _fails || jsonb_build_object('index',_i,'input',_codes[_i],'code',_c,'error','DUPLICATE_IN_LIST'); continue; end if;
    _v := public.business_seal_validate(_mid, _codes[_i], true);
    if not (_v->>'ok')::boolean then
      _fails := _fails || (_v || jsonb_build_object('index',_i,'input',_codes[_i])); continue; end if;
    _norm := _norm || _c;
  end loop;
  if jsonb_array_length(_fails) > 0 then
    return jsonb_build_object('ok',false,'failed',_fails);
  end if;
  for _i in 1.._n loop
    _oid := public.business_order_insert(_mid,_receiver_id,_pickup_point_id,null,null,1,_actor_label);
    update public.business_seal_stickers set status='used', business_order_id=_oid, entry_method=coalesce(_entry_methods[_i],'scan'), used_at=now()
     where code=_norm[_i];
    update public.business_orders set seal_code=_norm[_i], entry_method=coalesce(_entry_methods[_i],'scan') where id=_oid;
    perform public.business_audit('business_seal_use','business_seal_stickers',_oid,null,
      jsonb_build_object('code',_norm[_i],'order_id',_oid,'entry_method',coalesce(_entry_methods[_i],'scan')),_actor_label);
    _ids := _ids || _oid;
  end loop;
  return jsonb_build_object('ok',true,'order_ids',to_jsonb(_ids));
end $$;

create or replace function public.business_seal_stock(_merchant_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.courier_is_ops_staff() and (_merchant_id is distinct from public.current_merchant_id() or not public.merchant_caller_has_perm('manage_delivery')) then
    raise exception 'Forbidden' using errcode='42501'; end if;
  return (select jsonb_build_object(
    'available', count(*) filter (where status='available'),
    'used', count(*) filter (where status='used'),
    'void', count(*) filter (where status='void'),
    'avg_used_per_day_7d', round((count(*) filter (where status='used' and used_at >= now() - interval '7 days'))::numeric / 7, 2))
    from public.business_seal_stickers where merchant_id=_merchant_id);
end $$;

-- void helper for cancel/reject before pickup
create or replace function public.business_seal_void_for_batch(_batch_id uuid, _reason text)
returns int language plpgsql security definer set search_path to 'public' as $$
declare _n int;
begin
  update public.business_seal_stickers s set status='void', voided_at=now(), void_reason=_reason
    from public.business_orders o where o.batch_id=_batch_id and o.seal_code=s.code and s.status='used';
  get diagnostics _n = row_count;
  -- a new sticker is needed to re-send, so sealed orders of this trip are cancelled
  update public.business_orders set status='cancelled', cancelled_at=now(), cancel_reason=coalesce(cancel_reason,_reason)
   where batch_id=_batch_id and seal_code is not null and status in ('pending','batched');
  return _n;
end $$;

-- ========== 5. Changed existing functions (from LIVE defs) ==========
create or replace function public.business_cancel_order(_order_id uuid, _reason text DEFAULT NULL::text, _actor_label text DEFAULT NULL::text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _mid uuid := public.business_require_delivery(); _old jsonb; _new public.business_orders;
begin
  select to_jsonb(o) into _old from public.business_orders o where id=_order_id and merchant_id=_mid for update;
  if _old is null then raise exception 'Order not found'; end if;
  if _old->>'status' <> 'pending' then raise exception 'Only pending orders can be cancelled'; end if;
  update public.business_orders set status='cancelled', cancelled_at=now(), cancel_reason=nullif(btrim(coalesce(_reason,'')),'')
   where id=_order_id returning * into _new;
  if _new.seal_code is not null then
    update public.business_seal_stickers set status='void', voided_at=now(), void_reason='ORDER_CANCELLED'
     where code=_new.seal_code and status='used';
  end if;
  perform public.business_audit('business_cancel_order','business_orders',_order_id,_old,to_jsonb(_new),_actor_label);
end $function$;

create or replace function public.business_cancel_trip(_batch_id uuid, _reason text, _actor_label text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _mid uuid := public.business_require_delivery(); _b public.business_batches%rowtype; _old jsonb; _res jsonb; _v int;
begin
  if coalesce(btrim(_reason),'') = '' then raise exception 'A reason is required'; end if;
  select * into _b from public.business_batches where id=_batch_id for update;
  if _b.id is null or _b.merchant_id is distinct from _mid then raise exception 'Forbidden' using errcode='42501'; end if;
  if _b.courier_order_id is null or _b.status <> 'dispatched' then raise exception 'Only dispatched trips can be cancelled'; end if;
  _old := to_jsonb(_b);
  _res := public.business_reject_trip_internal(_b.courier_order_id, 'BUSINESS_CANCELLED', 'business', true);
  if coalesce((_res->>'ok')::boolean,false) is not true then
    if _res->>'reason' = 'PICKED_UP' then raise exception 'Parcels already picked up'; end if;
    raise exception 'Trip cannot be cancelled (%)', _res->>'reason';
  end if;
  update public.business_batches set status='rejected', fail_reason=left('CANCELLED: '||btrim(_reason),200) where id=_batch_id;
  _v := public.business_seal_void_for_batch(_batch_id, 'TRIP_CANCELLED');
  _res := _res || jsonb_build_object('stickers_voided', _v);
  perform public.business_audit('business_cancel_trip','business_batches',_batch_id,_old,
    (select to_jsonb(x) from public.business_batches x where id=_batch_id) || jsonb_build_object('result',_res), _actor_label);
  return _res;
end $function$;

create or replace function public.staff_business_reject_trip(_batch_id uuid, _reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _ok boolean; _b public.business_batches%rowtype; _old jsonb; _v int;
begin
  perform public.business_require_ops();
  if coalesce(btrim(_reason),'') = '' then raise exception 'A reason is required'; end if;
  select * into _b from public.business_batches where id=_batch_id for update;
  if _b.id is null or _b.courier_order_id is null then raise exception 'Trip not found'; end if;
  _old := to_jsonb(_b);
  -- single refund happens in business_sync_from_order ('refund:<order id>')
  _ok := public.business_reject_trip_internal(_b.courier_order_id, 'STAFF_REJECTED');
  if not _ok then raise exception 'Trip is not an unassigned business trip'; end if;
  update public.business_batches set status='rejected', fail_reason=left('REJECTED: '||btrim(_reason),200) where id=_batch_id;
  _v := public.business_seal_void_for_batch(_batch_id, 'TRIP_REJECTED');
  perform public.business_audit('staff_business_reject_trip','business_batches',_batch_id,_old,
    (select to_jsonb(x) from public.business_batches x where id=_batch_id) || jsonb_build_object('stickers_voided',_v), btrim(_reason));
  return jsonb_build_object('ok', true, 'amount', _b.total_amount, 'stickers_voided', _v);
end $function$;

create or replace function public.business_requeue_order(_order_id uuid, _actor_label text DEFAULT NULL::text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _mid uuid := public.business_require_delivery(); _o public.business_orders%rowtype; _new uuid;
begin
  select * into _o from public.business_orders where id=_order_id and merchant_id=_mid for update;
  if _o.id is null then raise exception 'Order not found'; end if;
  if _o.status not in ('failed','returned') then raise exception 'Only failed or returned orders can be sent again'; end if;
  if exists (select 1 from public.business_orders where requeued_from_id=_o.id) then
    raise exception 'This order was already sent again'; end if;
  -- the same physical sealed packet is re-sent: sticker link moves to the new order
  if _o.seal_code is not null then update public.business_orders set seal_code=null where id=_o.id; end if;
  insert into public.business_orders (merchant_id, receiver_id, pickup_point_id, reference_no, description, packet_count,
                                      status, created_by_label, requeued_from_id, seal_code, entry_method)
  values (_o.merchant_id, _o.receiver_id, _o.pickup_point_id, _o.reference_no, _o.description, _o.packet_count,
          'pending', left(_actor_label,120), _o.id, _o.seal_code, _o.entry_method)
  returning id into _new;
  if _o.seal_code is not null then
    update public.business_seal_stickers set business_order_id=_new where code=_o.seal_code;
  end if;
  perform public.business_audit('business_requeue_order','business_orders',_new,to_jsonb(_o),
    jsonb_build_object('from', _o.id, 'new_order_id', _new, 'seal_code', _o.seal_code), _actor_label);
  return _new;
end $function$;

create or replace function public.business_create_trip_packets(_batch_id uuid, _cid uuid)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
declare _b public.business_batches%rowtype; _d record; _o record; _i int; _k int; _code text; _n int := 0; _label text;
begin
  select * into _b from public.business_batches where id=_batch_id;
  if exists (select 1 from public.business_trip_packets where batch_id=_batch_id) then return 0; end if;
  for _d in
    select bo.drop_stop_id, bo.receiver_id,
           greatest(1, sum(case when bo.seal_code is not null then 1 else coalesce(bo.packet_count,1) end))::int total
      from public.business_orders bo
     where bo.batch_id=_batch_id and bo.courier_order_id=_cid and bo.drop_stop_id is not null
     group by bo.drop_stop_id, bo.receiver_id
  loop
    select dl.item->>'label' into _label from jsonb_array_elements(coalesce(_b.drop_labels,'[]'::jsonb)) dl(item)
     where (dl.item->>'receiver_id')::uuid = _d.receiver_id limit 1;
    _label := coalesce(_label, 'C?');
    _i := 0;
    for _o in select bo.seal_code, coalesce(bo.packet_count,1) pc from public.business_orders bo
               where bo.batch_id=_batch_id and bo.courier_order_id=_cid and bo.drop_stop_id=_d.drop_stop_id
               order by (bo.seal_code is null), bo.created_at, bo.id
    loop
      if _o.seal_code is not null then
        _i := _i + 1;
        -- packet rows from earlier cancelled trips must not block re-use of the same seal
        delete from public.business_trip_packets p using public.courier_orders co
         where p.code=_o.seal_code and co.id=p.courier_order_id and co.status='CANCELLED';
        insert into public.business_trip_packets(batch_id, courier_order_id, drop_stop_id, drop_label, packet_no, packet_total, code)
        values (_batch_id, _cid, _d.drop_stop_id, _label, _i, _d.total, _o.seal_code);
        _n := _n + 1;
      else
        for _k in 1.._o.pc loop
          _i := _i + 1;
          loop
            _code := format('T%s-%s-%s-%s', _b.trip_no, _label, _i,
                      upper(substr(translate(encode(extensions.gen_random_bytes(6),'base64'),'+/=0O1IL','XYZ'),1,4)));
            exit when not exists (select 1 from public.business_trip_packets where code=_code);
          end loop;
          insert into public.business_trip_packets(batch_id, courier_order_id, drop_stop_id, drop_label, packet_no, packet_total, code)
          values (_batch_id, _cid, _d.drop_stop_id, _label, _i, _d.total, _code);
          _n := _n + 1;
        end loop;
      end if;
    end loop;
  end loop;
  return _n;
end $function$;
revoke all on function public.business_create_trip_packets(uuid,uuid) from public, anon, authenticated;

drop function public.courier_scan_packet(uuid, text, text, uuid);
create function public.courier_scan_packet(_courier_order_id uuid, _code text, _stage text, _stop_id uuid, _entry_method text default 'scan')
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _eid uuid; _o public.courier_orders%rowtype; _st public.courier_order_stops%rowtype;
        _pk public.business_trip_packets%rowtype; _res text; _sc int; _tot int; _seal text; _em text := coalesce(_entry_method,'scan');
begin
  _eid := public.get_expert_id_for_auth(auth.uid());
  if _eid is null then raise exception 'Not a rider' using errcode='42501'; end if;
  if _stage not in ('pickup','drop') then raise exception 'Invalid stage'; end if;
  if _em not in ('scan','manual') then raise exception 'Invalid entry method'; end if;
  select * into _o from public.courier_orders where id=_courier_order_id for update;
  if _o.id is null or _o.assigned_expert_id is distinct from _eid then raise exception 'Forbidden' using errcode='42501'; end if;
  select * into _st from public.courier_order_stops where id=_stop_id;
  if _st.id is null or _st.order_id <> _o.id or _st.stop_type <> _stage then raise exception 'Invalid stop'; end if;

  _seal := public.seal_code_normalize(_code);
  if _seal is not null then
    select * into _pk from public.business_trip_packets where code=_seal and courier_order_id=_o.id for update;
    if _pk.id is null then select * into _pk from public.business_trip_packets where code=_seal order by created_at desc limit 1; end if;
  end if;
  if _pk.id is null then
    select * into _pk from public.business_trip_packets where code=upper(btrim(coalesce(_code,''))) for update;
  end if;
  if _pk.id is null then _res := 'unknown';
  elsif _pk.courier_order_id <> _o.id then _res := 'wrong_trip';
  elsif _stage='drop' and _pk.drop_stop_id <> _stop_id then _res := 'wrong_stop';
  elsif (_stage='pickup' and _pk.scanned_pickup_at is not null) or (_stage='drop' and _pk.scanned_drop_at is not null) then _res := 'already_scanned';
  else
    if _stage='pickup' then update public.business_trip_packets set scanned_pickup_at=now(), pickup_entry_method=_em where id=_pk.id;
    else update public.business_trip_packets set scanned_drop_at=now(), drop_entry_method=_em where id=_pk.id; end if;
    _res := 'ok';
  end if;

  if _stage='pickup' then
    select count(*) filter (where scanned_pickup_at is not null), count(*) into _sc, _tot
      from public.business_trip_packets where courier_order_id=_o.id;
  else
    select count(*) filter (where scanned_drop_at is not null), count(*) into _sc, _tot
      from public.business_trip_packets where drop_stop_id=_stop_id;
  end if;
  return jsonb_build_object('result', _res, 'ok', _res='ok', 'scanned', _sc, 'total', _tot, 'entry_method', _em,
    'packet_no', case when _res in ('ok','already_scanned') then _pk.packet_no end,
    'drop_label', case when _res in ('ok','already_scanned','wrong_stop') then _pk.drop_label end);
end $function$;

create or replace function public.courier_trip_packets(_courier_order_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _eid uuid; _o public.courier_orders%rowtype;
begin
  _eid := public.get_expert_id_for_auth(auth.uid());
  select * into _o from public.courier_orders where id=_courier_order_id;
  if _eid is null or _o.id is null or _o.assigned_expert_id is distinct from _eid then raise exception 'Forbidden' using errcode='42501'; end if;
  return jsonb_build_object('order_id', _o.id,
    'trip_no', (select trip_no from public.business_batches where courier_order_id=_o.id limit 1),
    'packets', coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'code',p.code,'drop_stop_id',p.drop_stop_id,
        'drop_label',p.drop_label,'packet_no',p.packet_no,'packet_total',p.packet_total,
        'scanned_pickup_at',p.scanned_pickup_at,'scanned_drop_at',p.scanned_drop_at,
        'pickup_entry_method',p.pickup_entry_method,'drop_entry_method',p.drop_entry_method,
        'is_seal', p.code ~ '^[0-9]{7}$',
        'printed_code', case when p.code ~ '^[0-9]{7}$' then left(p.code,6)||'-'||right(p.code,1) else p.code end)
        order by s.sequence, p.packet_no)
      from public.business_trip_packets p join public.courier_order_stops s on s.id=p.drop_stop_id
      where p.courier_order_id=_o.id),'[]'::jsonb));
end $function$;

-- billing: billable drops by plan basis
create or replace function public.business_finalize_batch(_batch_id uuid, _distance_km numeric, _distance_source text, _receiver_order uuid[])
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _b public.business_batches%rowtype; _p public.business_profiles%rowtype; _pl public.bulk_pricing_plans%rowtype;
        _m public.merchants%rowtype; _drops int; _fare numeric; _stops_fee numeric; _gstp numeric; _gst numeric;
        _total numeric; _fb jsonb; _cid uuid; _packets int; _billable int;
begin
  select * into _b from public.business_batches where id=_batch_id for update;
  if _b.id is null then return jsonb_build_object('ok', false, 'reason','NOT_FOUND'); end if;
  if _b.status not in ('planning','awaiting_balance') then
    return jsonb_build_object('ok', true, 'already', _b.status, 'courier_order_id', _b.courier_order_id);
  end if;
  select * into _p from public.business_profiles where merchant_id=_b.merchant_id;
  select * into _pl from public.bulk_pricing_plans where id=_p.pricing_plan_id and is_active;
  select * into _m from public.merchants where id=_b.merchant_id;

  if _pl.id is null then
    update public.business_batches set status='failed', fail_reason='NO_PLAN' where id=_batch_id;
    update public.business_orders set status='pending', batch_id=null, batched_at=null where batch_id=_batch_id;
    return jsonb_build_object('ok', false, 'reason','NO_PLAN');
  end if;
  if _m.auth_user_id is null then
    update public.business_batches set status='failed', fail_reason='OWNER_NOT_SIGNED_IN' where id=_batch_id;
    update public.business_orders set status='pending', batch_id=null, batched_at=null where batch_id=_batch_id;
    return jsonb_build_object('ok', false, 'reason','OWNER_NOT_SIGNED_IN');
  end if;
  _drops := coalesce(array_length(_receiver_order,1),0);
  if _drops = 0 then
    update public.business_batches set status='failed', fail_reason='NO_DROPS' where id=_batch_id;
    update public.business_orders set status='pending', batch_id=null, batched_at=null where batch_id=_batch_id;
    return jsonb_build_object('ok', false, 'reason','NO_DROPS');
  end if;

  if _b.dispatch_run_id is not null then
    update public.business_orders
       set batch_id=_batch_id
     where merchant_id=_b.merchant_id
       and pickup_point_id=_b.pickup_point_id
       and dispatch_run_id=_b.dispatch_run_id
       and status='batched'
       and batch_id is null
       and receiver_id = any(_receiver_order);
  end if;

  select count(*) into _packets from public.business_orders where batch_id=_batch_id and receiver_id = any(_receiver_order);
  _billable := case when coalesce(_pl.drop_count_basis,'packet') = 'packet' then greatest(_packets, _drops) else _drops end;

  _fare := greatest(coalesce(_pl.min_fare,0),
             coalesce(_pl.base_fare,0) + greatest(0, coalesce(_distance_km,0) - coalesce(_pl.included_km,0)) * coalesce(_pl.per_km,0));
  _stops_fee := coalesce(_pl.extra_drop_fee,0) * greatest(0, _billable - 1);
  _fare := round(_fare, 2);
  _stops_fee := round(_stops_fee, 2);
  _gstp := public.get_gst_percent();
  _gst := round((_fare + _stops_fee) * _gstp / 100.0, 2);
  _total := round(_fare + _stops_fee + _gst, 2);
  _fb := jsonb_build_object(
    'source','business_plan','plan_id',_pl.id,'plan_name',_pl.name,
    'distance_km',_distance_km,'drops',_drops,
    'stops',_drops,'packet_count',_packets,'drop_count_basis',coalesce(_pl.drop_count_basis,'packet'),'billable_drops',_billable,
    'base_amount',_fare,'stops_fee',_stops_fee,
    'gst_percent',_gstp,'gst_amount',_gst,'total_amount',_total,
    'commission_pct', coalesce(_pl.commission_pct,0),
    'return_per_km', coalesce(_pl.return_per_km,0));

  if coalesce(_m.delivery_wallet_balance,0) < _total then
    update public.business_batches
       set status='awaiting_balance', fail_reason='LOW_BALANCE', total_amount=_total,
           fare_breakdown=_fb, distance_km=_distance_km, distance_source=_distance_source, claimed_at=null
     where id=_batch_id;
    perform public.business_notify(_b.merchant_id, 'Low wallet balance',
      'Top up to dispatch ' || (select count(*) from public.business_orders where batch_id=_batch_id) || ' orders',
      jsonb_build_object('batch_id',_batch_id,'needed',_total));
    return jsonb_build_object('ok', false, 'reason','LOW_BALANCE','total',_total);
  end if;

  _cid := public.courier_create_business_order(_batch_id, _distance_km, _distance_source, _receiver_order, _fb);
  perform public.business_wallet_post(_b.merchant_id, 'debit', _total, 'batch:' || _cid::text, false, null);
  update public.business_batches
     set status='dispatched', fail_reason=null, total_amount=_total, fare_breakdown=_fb,
         distance_km=_distance_km, distance_source=_distance_source, courier_order_id=_cid, claimed_at=null
   where id=_batch_id;
  perform public.courier_start_dispatch(_cid);
  return jsonb_build_object('ok', true, 'courier_order_id', _cid, 'total', _total);
exception when others then
  update public.business_batches set status='failed', fail_reason=left(sqlerrm,200), claimed_at=null where id=_batch_id;
  update public.business_orders set status='pending', batch_id=null, batched_at=null, courier_order_id=null, parcel_id=null, drop_stop_id=null
   where batch_id=_batch_id and status='batched';
  return jsonb_build_object('ok', false, 'reason', left(sqlerrm,200));
end $function$;

-- ========== 6. Grants ==========
revoke all on function public.seal_luhn_digit(text), public.seal_code_for_serial(int),
  public.business_seal_validate(uuid,text,boolean), public.business_seal_void_for_batch(uuid,text) from public, anon, authenticated;
revoke all on function public.staff_seal_create_batch(int,int,text), public.staff_seal_assign_batch(uuid,uuid,numeric),
  public.staff_seal_void(text,text), public.staff_seal_batch_export(uuid), public.staff_seal_lookup(text),
  public.business_seal_check(uuid,text), public.business_create_packet_orders(uuid,uuid,uuid,text[],text[],text),
  public.business_seal_stock(uuid), public.courier_scan_packet(uuid,text,text,uuid,text) from public, anon;
grant execute on function public.staff_seal_create_batch(int,int,text), public.staff_seal_assign_batch(uuid,uuid,numeric),
  public.staff_seal_void(text,text), public.staff_seal_batch_export(uuid), public.staff_seal_lookup(text),
  public.business_seal_check(uuid,text), public.business_create_packet_orders(uuid,uuid,uuid,text[],text[],text),
  public.business_seal_stock(uuid), public.courier_scan_packet(uuid,text,text,uuid,text),
  public.seal_code_normalize(text), public.seal_luhn_ok(text), public.seal_printed_text(text) to authenticated;
