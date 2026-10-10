CREATE OR REPLACE FUNCTION public.customer_lucky_draw_enrol()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c lucky_draw_campaigns; u users; _no text; _existing text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Login required'; END IF;
  SELECT * INTO u FROM users WHERE id=auth.uid() AND deleted_at IS NULL;
  IF u.id IS NULL OR coalesce(u.phone,'') = '' THEN RAISE EXCEPTION 'Verified mobile number required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id=auth.uid() AND (au.phone_confirmed_at IS NOT NULL OR au.phone IS NOT NULL OR au.email_confirmed_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'Verified mobile number required'; END IF;
  SELECT * INTO c FROM lucky_draw_campaigns WHERE is_active FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'No active lucky draw'; END IF;
  IF now() < c.start_at THEN RAISE EXCEPTION 'Lucky draw has not started yet'; END IF;
  IF now() > c.end_at OR c.draw_executed_at IS NOT NULL THEN RAISE EXCEPTION 'Enrolment is closed'; END IF;
  SELECT entry_no INTO _existing FROM lucky_draw_enrolments WHERE campaign_id=c.id AND user_id=auth.uid();
  IF _existing IS NOT NULL THEN RETURN jsonb_build_object('entry_no',_existing,'already_enrolled',true); END IF;
  UPDATE lucky_draw_campaigns SET entry_counter=entry_counter+1 WHERE id=c.id RETURNING 'BDY-'||lpad(entry_counter::text,5,'0') INTO _no;
  INSERT INTO lucky_draw_enrolments(campaign_id,user_id,entry_no) VALUES (c.id, auth.uid(), _no);
  RETURN jsonb_build_object('entry_no',_no,'already_enrolled',false);
END $$;