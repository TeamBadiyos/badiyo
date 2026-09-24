CREATE OR REPLACE FUNCTION public.merchant_advance_order(_order_id uuid, _new_status text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _merchant_id uuid; _ctx jsonb; _current text; _courier uuid; _ok boolean;
begin
  _merchant_id := public.current_merchant_id();
  if _merchant_id is null then raise exception 'not_a_merchant'; end if;
  _ctx := public.merchant_my_context();
  if not ((_ctx->>'is_owner')::boolean or _ctx->'permissions' ? 'manage_orders') then raise exception 'not_permitted'; end if;
  if _new_status = 'packed' then _new_status := 'ready'; end if;
  select status, courier_order_id into _current, _courier from public.merchant_orders
   where id = _order_id and merchant_id = _merchant_id;
  if _current is null then raise exception 'order_not_found'; end if;
  if _courier is not null then
    -- Expert-delivered: the shop may only mark the parcel ready for pickup.
    if _new_status = 'ready' and _current in ('accepted','expert_assigned') then
      perform public.store_set_status(_order_id, 'ready', 'merchant_ready');
      return;
    end if;
    raise exception 'delivery_managed_by_expert';
  end if;
  _ok := (_new_status = 'preparing' and _current = 'accepted') or (_new_status = 'ready' and _current = 'preparing')
      or (_new_status = 'completed' and _current = 'ready');
  if not _ok then raise exception 'invalid_transition'; end if;
  perform public.store_set_status(_order_id, _new_status, 'merchant_' || _new_status);
end $function$;

CREATE OR REPLACE FUNCTION public.store_sync_from_courier()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _cur text;
begin
  if NEW.store_order_id is null or NEW.status is not distinct from OLD.status then return NEW; end if;
  select status into _cur from public.merchant_orders where id = NEW.store_order_id;
  if _cur in ('rejected','cancelled','delivered','completed') then return NEW; end if;
  if NEW.status = 'DRIVER_ASSIGNED' then
    if _cur = 'ready' then
      perform public.store_audit(NEW.store_order_id, 'courier_expert_assigned', jsonb_build_object('status', _cur),
        jsonb_build_object('status', _cur, 'expert_id', NEW.assigned_expert_id));
    else
      perform public.store_set_status(NEW.store_order_id, 'expert_assigned', 'courier_expert_assigned', jsonb_build_object('expert_id', NEW.assigned_expert_id));
    end if;
    update public.merchant_orders set needs_attention = false where id = NEW.store_order_id;
  elsif NEW.status = 'SEARCHING' and OLD.status in ('DRIVER_ASSIGNED','ARRIVED_PICKUP') then
    if _cur <> 'ready' then
      perform public.store_set_status(NEW.store_order_id, 'accepted', 'courier_expert_released');
    end if;
  elsif NEW.status = 'PICKED_UP' then
    perform public.store_set_status(NEW.store_order_id, 'picked_up', 'courier_pickup_otp_verified');
    update public.merchant_orders set picked_up_at = coalesce(picked_up_at, now()) where id = NEW.store_order_id;
  elsif NEW.status = 'DELIVERED' then
    perform public.store_set_status(NEW.store_order_id, 'delivered', 'courier_delivery_otp_verified');
    update public.merchant_orders set delivered_at = coalesce(delivered_at, now()) where id = NEW.store_order_id;
  elsif NEW.status in ('CANCELLED','FAILED_DELIVERY') then
    update public.merchant_orders set needs_attention = true where id = NEW.store_order_id;
    perform public.store_set_status(NEW.store_order_id, 'needs_attention', 'courier_' || lower(NEW.status),
      jsonb_build_object('reason', NEW.cancel_reason_code));
    perform public.admin_alert_enqueue('store_attention', NEW.store_order_id, 'Store delivery problem', null, NEW.total_amount, 'Now');
  end if;
  return NEW;
end $function$;

CREATE OR REPLACE FUNCTION public.merchant_get_order_rider(_order_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _mid uuid; _o record; _e record;
begin
  _mid := public.current_merchant_id();
  if _mid is null then return null; end if;
  select mo.status, c.assigned_expert_id into _o
    from public.merchant_orders mo join public.courier_orders c on c.id = mo.courier_order_id
   where mo.id = _order_id and mo.merchant_id = _mid;
  if _o.assigned_expert_id is null or _o.status not in ('expert_assigned','ready','picked_up') then return null; end if;
  select name, phone into _e from public.experts where id = _o.assigned_expert_id;
  return jsonb_build_object('name', _e.name, 'phone', _e.phone);
end $function$;
revoke all on function public.merchant_get_order_rider(uuid) from public, anon;
grant execute on function public.merchant_get_order_rider(uuid) to authenticated, service_role;