-- Sync migration history with the live definition: staff_list_unassigned_business_trips()
-- already returns batch_id in the database; this records that definition in a
-- migration file so a fresh replay keeps the field.
create or replace function public.staff_list_unassigned_business_trips()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  perform public.business_require_ops();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'courier_order_id', c.id, 'batch_id', b.id, 'order_code', c.order_code, 'status', c.status,
      'merchant_id', c.business_merchant_id, 'business_name', bp.business_name,
      'trip_no', b.trip_no, 'trip_label', b.trip_label, 'drops', b.drops_count,
      'total_amount', c.total_amount, 'search_started_at', c.search_started_at,
      'needs_ops_attention', c.needs_ops_attention) order by c.created_at)
    from public.courier_orders c
    left join public.business_batches b on b.courier_order_id=c.id
    left join public.business_profiles bp on bp.merchant_id=c.business_merchant_id
   where c.source='business' and c.status in ('REQUESTED','SEARCHING') and c.assigned_expert_id is null), '[]'::jsonb);
end
$function$;

revoke all on function public.staff_list_unassigned_business_trips() from public, anon;
grant execute on function public.staff_list_unassigned_business_trips() to authenticated;