CREATE OR REPLACE FUNCTION public.business_create_trip_packets(_batch_id uuid, _cid uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
declare _b public.business_batches%rowtype; _d record; _i int; _code text; _n int := 0; _label text;
begin
  select * into _b from public.business_batches where id=_batch_id;
  if exists (select 1 from public.business_trip_packets where batch_id=_batch_id) then return 0; end if;
  for _d in
    select bo.drop_stop_id, bo.receiver_id, greatest(1, sum(coalesce(bo.packet_count,1)))::int total
      from public.business_orders bo
     where bo.batch_id=_batch_id and bo.courier_order_id=_cid and bo.drop_stop_id is not null
     group by bo.drop_stop_id, bo.receiver_id
  loop
    select dl.item->>'label' into _label from jsonb_array_elements(coalesce(_b.drop_labels,'[]'::jsonb)) dl(item)
     where (dl.item->>'receiver_id')::uuid = _d.receiver_id limit 1;
    _label := coalesce(_label, 'C?');
    for _i in 1.._d.total loop
      loop
        _code := format('T%s-%s-%s-%s', _b.trip_no, _label, _i,
                  upper(substr(translate(encode(extensions.gen_random_bytes(6),'base64'),'+/=0O1IL','XYZ'),1,4)));
        exit when not exists (select 1 from public.business_trip_packets where code=_code);
      end loop;
      insert into public.business_trip_packets(batch_id, courier_order_id, drop_stop_id, drop_label, packet_no, packet_total, code)
      values (_batch_id, _cid, _d.drop_stop_id, _label, _i, _d.total, _code);
      _n := _n + 1;
    end loop;
  end loop;
  return _n;
end $$;

REVOKE ALL ON FUNCTION public.business_create_trip_packets(uuid, uuid) FROM public, anon, authenticated;