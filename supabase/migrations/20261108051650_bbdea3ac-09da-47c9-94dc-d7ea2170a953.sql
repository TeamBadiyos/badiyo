CREATE OR REPLACE FUNCTION public.notify_customer_status_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare _title text; _body text; _alert text; _expert text;
begin
  if NEW.status is not distinct from OLD.status then return NEW; end if;

  if NEW.status = 'expert_assigned' then
    select name into _expert from public.experts where id = NEW.assigned_expert_id;
    _alert := 'expert_assigned'; _title := 'Expert assigned!';
    _body := coalesce(_expert, 'Your expert') || ' has accepted ' || coalesce(NEW.service_label, 'your booking') || '. Start OTP app me dekhein.';
  elsif NEW.status = 'on_the_way' then
    select name into _expert from public.experts where id = NEW.assigned_expert_id;
    _alert := 'expert_on_the_way'; _title := 'Expert on the way';
    _body := coalesce(_expert, 'Your expert') || ' is on the way. Start OTP app me dekhein.';
  elsif NEW.status = 'arrived' then
    select name into _expert from public.experts where id = NEW.assigned_expert_id;
    _alert := 'expert_arrived'; _title := 'Expert has arrived';
    _body := coalesce(_expert, 'Your expert') || ' has reached your location. Start OTP app me dekhein.';
  elsif NEW.status = 'in_progress' then
    _alert := 'service_started'; _title := 'Service started';
    _body := 'Kaam khatam hone par End OTP app me dekhein.';
  elsif NEW.status = 'completed' then
    _alert := 'order_completed'; _title := 'Service completed';
    _body := 'Your booking is complete! Please rate your experience.';
  elsif NEW.status = 'cancelled' then
    _alert := 'booking_cancelled'; _title := 'Booking cancelled';
    _body := coalesce(NEW.cancellation_reason, 'Your booking has been cancelled.');
  elsif NEW.status = 'accepted' then
    _alert := 'booking_confirmed'; _title := 'Booking confirmed';
    _body := 'We are finding an expert for you.';
  else
    return NEW;
  end if;

  perform public.notify_customer_alert(NEW.id, _alert, _title, _body,
    jsonb_build_object('route', case when NEW.status = 'cancelled' then 'my-bookings'
                                     else 'booking/' || NEW.id::text end,
                       'bookingId', NEW.id::text, 'status', NEW.status));
  return NEW;
end $$;