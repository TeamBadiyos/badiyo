-- Cleanup test attribution: Gaurav (older account) wrongly linked to Aditya's code
DELETE FROM public.lucky_draw_tickets WHERE ticket_no = 'BDY-00043'
  AND user_id = 'f164c5b2-988d-4ad7-9872-504efcf55d83'
  AND referred_user_id = 'afa52a58-9a32-4eee-8e65-8bfc58ed9cd2';
SELECT set_config('app.users_bypass','on',true);
UPDATE public.users SET referred_by = NULL WHERE id = 'afa52a58-9a32-4eee-8e65-8bfc58ed9cd2' AND referred_by = '6F51FE';

-- Permanent guard: an account can only be referred by someone who joined before it
CREATE OR REPLACE FUNCTION public.users_guard_referred_by()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _ref_created timestamptz;
BEGIN
  IF NEW.referred_by IS NULL OR NEW.referred_by = '' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.referred_by IS NOT DISTINCT FROM NEW.referred_by THEN RETURN NEW; END IF;
  SELECT created_at INTO _ref_created FROM public.users
   WHERE upper(referral_code) = upper(NEW.referred_by) AND id <> NEW.id LIMIT 1;
  IF _ref_created IS NOT NULL AND NEW.created_at IS NOT NULL AND _ref_created > NEW.created_at THEN
    RAISE EXCEPTION 'not_eligible_existing_user' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_users_guard_referred_by ON public.users;
CREATE TRIGGER trg_users_guard_referred_by BEFORE INSERT OR UPDATE OF referred_by ON public.users
FOR EACH ROW EXECUTE FUNCTION public.users_guard_referred_by();

-- Lucky draw: only count friends who joined after the referrer
CREATE OR REPLACE FUNCTION public.lucky_draw_standings(_campaign_id uuid, _cutoff timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(user_id uuid, entry_no text, enrolled_at timestamp with time zone, full_name text, phone text, referrals integer, entries integer, rank integer)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH c AS (SELECT * FROM lucky_draw_campaigns WHERE id = _campaign_id),
  e AS (SELECT le.* FROM lucky_draw_enrolments le WHERE le.campaign_id = _campaign_id AND (_cutoff IS NULL OR le.enrolled_at <= _cutoff)),
  r AS (
    SELECT e.user_id, count(f.user_id)::int AS refs
    FROM e JOIN users u ON u.id = e.user_id
    LEFT JOIN users fu ON u.referral_code IS NOT NULL AND fu.referred_by = u.referral_code AND fu.id <> u.id AND fu.created_at >= u.created_at
    LEFT JOIN e f ON f.user_id = fu.id
    GROUP BY e.user_id)
  SELECT e.user_id, e.entry_no, e.enrolled_at, u.full_name, u.phone, coalesce(r.refs,0),
    (1 + CASE WHEN (SELECT referral_bonus_enabled FROM c) THEN coalesce(r.refs,0) ELSE 0 END)::int,
    (row_number() OVER (ORDER BY coalesce(r.refs,0) DESC, e.enrolled_at ASC))::int
  FROM e JOIN users u ON u.id = e.user_id LEFT JOIN r ON r.user_id = e.user_id
$function$;

CREATE OR REPLACE FUNCTION public.lucky_draw_sync_tickets(_campaign_id uuid)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE c lucky_draw_campaigns; r record; _no text; _n int := 0;
BEGIN
  SELECT * INTO c FROM lucky_draw_campaigns WHERE id=_campaign_id FOR UPDATE;
  IF c.id IS NULL OR c.draw_executed_at IS NOT NULL THEN RETURN 0; END IF;
  INSERT INTO lucky_draw_tickets(campaign_id,user_id,ticket_no,ticket_type,created_at)
  SELECT e.campaign_id,e.user_id,e.entry_no,'base',e.enrolled_at FROM lucky_draw_enrolments e
  WHERE e.campaign_id=_campaign_id ON CONFLICT (campaign_id,ticket_no) DO NOTHING;
  IF NOT c.referral_bonus_enabled THEN RETURN 0; END IF;
  FOR r IN
    SELECT e.user_id, fe.user_id AS friend_id
    FROM lucky_draw_enrolments e JOIN users u ON u.id=e.user_id
    JOIN users fu ON u.referral_code IS NOT NULL AND fu.referred_by=u.referral_code AND fu.id<>u.id AND fu.created_at >= u.created_at
    JOIN lucky_draw_enrolments fe ON fe.campaign_id=_campaign_id AND fe.user_id=fu.id
    WHERE e.campaign_id=_campaign_id AND (now() <= c.end_at)
      AND NOT EXISTS (SELECT 1 FROM lucky_draw_tickets t WHERE t.campaign_id=_campaign_id AND t.user_id=e.user_id AND t.referred_user_id=fu.id)
    ORDER BY greatest(e.enrolled_at, fe.enrolled_at)
  LOOP
    UPDATE lucky_draw_campaigns SET entry_counter=entry_counter+1 WHERE id=_campaign_id RETURNING 'BDY-'||lpad(entry_counter::text,5,'0') INTO _no;
    INSERT INTO lucky_draw_tickets(campaign_id,user_id,ticket_no,ticket_type,referred_user_id) VALUES (_campaign_id,r.user_id,_no,'referral',r.friend_id);
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $function$;
REVOKE EXECUTE ON FUNCTION public.users_guard_referred_by() FROM PUBLIC, anon, authenticated;