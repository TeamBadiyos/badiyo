CREATE OR REPLACE FUNCTION public.bookings_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
declare
  _bypass text;
  _gst numeric;
  _allow jsonb;
  _spo record;
  _matches int;
  _used_fallback boolean := false;
  _duration int;
  _addr_lat numeric;
  _addr_lng numeric;
begin
  begin _bypass := current_setting('app.booking_bypass', true); exception when others then _bypass := null; end;

  if NEW.price_option_id is not null then
    select spo.id, spo.customer_price, spo.estimated_minutes, spo.duration_minutes,
           spo.label, s.category_id
      into _spo
      from public.service_price_options spo
      join public.services s on s.id = spo.service_id
     where spo.id = NEW.price_option_id
       and spo.is_active = true
       and s.is_active = true;

    if _spo.id is null then
      raise exception 'SERVICE_OPTION_NOT_AVAILABLE'
        using errcode = 'check_violation',
              hint = 'The selected service option no longer exists or is inactive.';
    end if;
  else
    select count(*) into _matches
      from public.service_price_options spo
      join public.services s on s.id = spo.service_id
     where spo.is_active = true
       and s.is_active = true
       and lower(btrim(spo.label)) = lower(btrim(coalesce(NEW.service_label, '')))
       and (NEW.service_category_id is null or s.category_id = NEW.service_category_id);

    if _matches <> 1 then
      raise exception 'SERVICE_OPTION_AMBIGUOUS:%', coalesce(NEW.service_label, '')
        using errcode = 'check_violation',
              hint = 'Please update the app and select the service again.';
    end if;

    select spo.id, spo.customer_price, spo.estimated_minutes, spo.duration_minutes,
           spo.label, s.category_id
      into _spo
      from public.service_price_options spo
      join public.services s on s.id = spo.service_id
     where spo.is_active = true
       and s.is_active = true
       and lower(btrim(spo.label)) = lower(btrim(coalesce(NEW.service_label, '')))
       and (NEW.service_category_id is null or s.category_id = NEW.service_category_id);

    _used_fallback := true;
    NEW.price_option_id := _spo.id;
  end if;

  _duration := coalesce(_spo.estimated_minutes, _spo.duration_minutes);
  if _duration is null or _duration <= 0 then
    raise exception 'SERVICE_DURATION_NOT_CONFIGURED:%', _spo.label
      using errcode = 'check_violation',
            hint = 'Set estimated_minutes for this service option in the Command Center.';
  end if;

  NEW.price := _spo.customer_price;
  NEW.service_duration_minutes := _duration;
  NEW.service_label := coalesce(NEW.service_label, _spo.label);
  if NEW.service_category_id is null then
    NEW.service_category_id := _spo.category_id;
  end if;

  if _bypass is distinct from 'on' and not public.service_hours_bypass() then
    _allow := public.service_slot_allowed('clean', NEW.scheduled_date, NEW.scheduled_time_slot, _duration);
    if not coalesce((_allow->>'ok')::boolean, true) then
      raise exception 'SERVICE_CLOSED:%:%', _allow->>'reason_code', coalesce(_allow->>'next_open_at', '')
        using errcode = 'check_violation';
    end if;
  end if;

  _gst := coalesce(public.get_gst_percent(), 0);
  if _gst < 0 or _gst > 100 then _gst := 0; end if;
  NEW.gst_percent := _gst;
  NEW.gst_amount := round(NEW.price * _gst / 100.0, 2);
  NEW.total_amount := NEW.price + NEW.gst_amount;

  NEW.status := 'confirmed';
  NEW.rating := null;
  NEW.review_text := null;

  if _bypass is distinct from 'on' then
    NEW.assigned_expert_id := null;
    NEW.refund_id := null;
    NEW.refund_status := null;
    NEW.refund_amount := null;
    NEW.cancellation_fee := null;
    NEW.cancellation_reason := null;
    NEW.cancelled_by := null;
    NEW.cancelled_at := null;
    NEW.started_at := null;
    NEW.service_end_at := null;
    NEW.start_otp := null;
    NEW.end_otp := null;
    NEW.broadcast_started_at := null;
    NEW.current_search_radius_km := null;
    NEW.deleted_at := null;
    NEW.deleted_by := null;
    NEW.delete_reason := null;
  end if;

  if (NEW.booking_lat is null or NEW.booking_lng is null) and NEW.address_id is not null then
    select latitude, longitude into _addr_lat, _addr_lng
      from public.addresses where id = NEW.address_id;
    if NEW.booking_lat is null then NEW.booking_lat := _addr_lat; end if;
    if NEW.booking_lng is null then NEW.booking_lng := _addr_lng; end if;
  end if;

  if NEW.booking_lat is null or NEW.booking_lng is null then
    raise exception 'Booking requires geographic coordinates: booking_lat/booking_lng were not provided and could not be resolved from address_id %', NEW.address_id
      using errcode = 'check_violation', hint = 'Ensure the selected address has latitude/longitude, or pass booking_lat/booking_lng explicitly.';
  end if;

  if _used_fallback then
    begin
      insert into public.booking_price_fallback_log(booking_id, service_label, service_category_id, matched_price_option_id)
      values (NEW.id, NEW.service_label, NEW.service_category_id, _spo.id);
    exception when others then null;
    end;
  end if;

  return NEW;
end
$fn$;