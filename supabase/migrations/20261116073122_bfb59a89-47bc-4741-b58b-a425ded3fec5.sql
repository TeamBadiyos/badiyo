CREATE OR REPLACE FUNCTION public.courier_prepare_customer_otps()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s record; x public.courier_stop_secrets%rowtype; pending_pickups boolean;
BEGIN
  IF NEW.status NOT IN ('DRIVER_ASSIGNED','ARRIVED_PICKUP','PICKED_UP','IN_TRANSIT') OR public.courier_is_gifting_order(NEW.id) THEN RETURN NEW; END IF;
  SELECT EXISTS(SELECT 1 FROM public.courier_order_stops WHERE order_id=NEW.id AND stop_type='pickup' AND status NOT IN ('completed','failed','cancelled')) INTO pending_pickups;
  BEGIN
    FOR s IN SELECT id FROM public.courier_order_stops WHERE order_id=NEW.id AND status NOT IN ('completed','failed','cancelled') AND ((stop_type='pickup' AND pending_pickups) OR (stop_type IN ('drop','return') AND NOT pending_pickups)) ORDER BY sequence LOOP
      INSERT INTO public.courier_stop_secrets(stop_id) VALUES(s.id) ON CONFLICT DO NOTHING;
      SELECT * INTO x FROM public.courier_stop_secrets WHERE stop_id=s.id FOR UPDATE;
      IF x.verified_at IS NULL AND (x.otp_issued_at IS NULL OR x.otp_hash IS NULL OR x.otp_expires_at IS NULL OR x.otp_expires_at<=now()) THEN PERFORM public.courier_issue_stop_otp(s.id); END IF;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'Parcel OTP preparation failed for %',NEW.id;
  END;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    BEGIN
      PERFORM public.notify_customer_user_push(NEW.customer_id,'Parcel update',CASE WHEN pending_pickups THEN 'Pickup OTP app me dekhein' ELSE 'Drop OTP app me dekhein' END,'courier/' || NEW.id::text);
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'Parcel OTP push failed for %',NEW.id;
    END;
  END IF;
  RETURN NEW;
END $$;