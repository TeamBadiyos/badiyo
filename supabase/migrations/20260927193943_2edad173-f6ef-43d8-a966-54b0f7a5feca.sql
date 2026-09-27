
create or replace function public.business_cancel_trip(_batch_id uuid, _reason text, _actor_label text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _mid uuid := public.business_require_delivery(); _b public.business_batches%rowtype; _old jsonb; _res jsonb;
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
  perform public.business_audit('business_cancel_trip','business_batches',_batch_id,_old,
    (select to_jsonb(x) from public.business_batches x where id=_batch_id) || jsonb_build_object('result',_res), _actor_label);
  return _res;
end $function$;

create or replace function public.staff_business_reject_trip(_batch_id uuid, _reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _ok boolean; _b public.business_batches%rowtype; _old jsonb;
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
  perform public.business_audit('staff_business_reject_trip','business_batches',_batch_id,_old,
    (select to_jsonb(x) from public.business_batches x where id=_batch_id), btrim(_reason));
  return jsonb_build_object('ok', true, 'amount', _b.total_amount);
end $function$;

drop function public.business_seal_void_for_batch(uuid, text);
