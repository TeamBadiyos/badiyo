create or replace function public.bookings_check_slot_capacity() returns trigger
language plpgsql security definer set search_path to 'public' as $fn$
declare _bypass text;
BEGIN
  begin _bypass := current_setting('app.booking_bypass', true); exception when others then _bypass := null; end;
  IF _bypass = 'on' THEN RETURN NEW; END IF;
  IF coalesce(NEW.slot_type,'now') = 'now' THEN
    IF NOT public.instant_booking_enabled() THEN
      RAISE EXCEPTION 'Instant bookings are currently full due to high demand. Please pick a scheduled slot.' USING errcode='check_violation';
    END IF;
  ELSIF NEW.scheduled_date IS NOT NULL AND public.slot_is_fully_booked('clean', NEW.scheduled_date, NEW.scheduled_time_slot, NEW.service_duration_minutes) THEN
    RAISE EXCEPTION 'This slot is now fully booked. Please select another slot.' USING errcode='check_violation';
  END IF;
  RETURN NEW;
END $fn$;

do $$
declare _bid uuid;
begin
  if exists (select 1 from public.payment_intents where id='a77a945c-3d0a-4a00-93f1-37c6152f0316' and booking_id is null) then
    perform set_config('app.booking_bypass','on', true);
    insert into public.bookings (user_id, address_id, booking_lat, booking_lng, price_option_id,
      service_category_id, service_label, service_duration_minutes, slot_type,
      price, total_amount, razorpay_order_id, razorpay_payment_id, status)
    values ('1a398979-226a-4f55-9417-31312486febf','04d69138-c9ad-4818-b0ad-1d2f0eb4369c',
      18.4058874, 76.5784486, 'acdc740f-24f3-4abc-b416-9f3d043fc1f7',
      '508641a3-59fd-457c-be6a-74879be354cc', '2 Hours', 120, 'now',
      289, 225, 'order_TljFHQlpdCIc9Z', 'pay_TljFuh8usOF8pf', 'confirmed')
    returning id into _bid;
    perform set_config('app.booking_bypass','off', true);
    update public.payment_intents set status='fulfilled', booking_id=_bid,
      razorpay_payment_id='pay_TljFuh8usOF8pf', updated_at=now()
     where id='a77a945c-3d0a-4a00-93f1-37c6152f0316';
    update public.coupon_redemptions set status='applied', booking_id=_bid, updated_at=now()
     where id='361d2ed2-16bc-495c-b5aa-20f3187a57fd' and status='reserved';
    perform set_config('app.booking_bypass','on', true);
    update public.bookings set status='accepted', broadcast_started_at=now() where id=_bid;
    perform set_config('app.booking_bypass','off', true);
  end if;
end $$;