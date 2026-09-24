update public.merchant_orders set refund_status = coalesce(refund_status,'none'), refund_amount = coalesce(refund_amount,0);
alter table public.merchant_orders alter column refund_status set default 'none';
alter table public.merchant_orders alter column refund_amount set default 0;
create or replace function public.store_mark_refund(_order_id uuid, _reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.merchant_orders
     set refund_status = 'refund_pending', refund_amount = total_amount, refund_reason = _reason,
         refund_next_attempt_at = now(), payment_status = 'refund_pending', updated_at = now()
   where id = _order_id and payment_status = 'paid' and coalesce(refund_status,'none') in ('none');
  if found then
    perform public.store_audit(_order_id, 'store_refund_requested', null, jsonb_build_object('reason', _reason));
    perform public.store_dispatch_refund_job();
  end if;
end $$;
revoke all on function public.store_mark_refund(uuid,text) from public, anon, authenticated;