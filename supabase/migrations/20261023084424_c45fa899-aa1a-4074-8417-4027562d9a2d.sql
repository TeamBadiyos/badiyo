CREATE OR REPLACE FUNCTION public.lucky_draw_standings(_campaign_id uuid, _cutoff timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(user_id uuid, entry_no text, enrolled_at timestamp with time zone, full_name text, phone text, referrals integer, entries integer, rank integer)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH c AS (SELECT * FROM lucky_draw_campaigns WHERE id = _campaign_id),
  e AS (SELECT le.* FROM lucky_draw_enrolments le WHERE le.campaign_id = _campaign_id AND (_cutoff IS NULL OR le.enrolled_at <= _cutoff)),
  r AS (
    SELECT e.user_id, count(fu.id)::int AS refs
    FROM e JOIN users u ON u.id = e.user_id
    LEFT JOIN users fu ON u.referral_code IS NOT NULL AND fu.referred_by = u.referral_code AND fu.id <> u.id AND fu.created_at >= u.created_at
      AND (_cutoff IS NULL OR fu.created_at <= _cutoff)
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
    SELECT e.user_id, fu.id AS friend_id
    FROM lucky_draw_enrolments e JOIN users u ON u.id=e.user_id
    JOIN users fu ON u.referral_code IS NOT NULL AND fu.referred_by=u.referral_code AND fu.id<>u.id AND fu.created_at >= u.created_at
    WHERE e.campaign_id=_campaign_id AND now() <= c.end_at
      AND NOT EXISTS (SELECT 1 FROM lucky_draw_tickets t WHERE t.campaign_id=_campaign_id AND t.user_id=e.user_id AND t.referred_user_id=fu.id)
    ORDER BY fu.created_at
  LOOP
    UPDATE lucky_draw_campaigns SET entry_counter=entry_counter+1 WHERE id=_campaign_id RETURNING 'BDY-'||lpad(entry_counter::text,5,'0') INTO _no;
    INSERT INTO lucky_draw_tickets(campaign_id,user_id,ticket_no,ticket_type,referred_user_id) VALUES (_campaign_id,r.user_id,_no,'referral',r.friend_id);
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $function$;

CREATE OR REPLACE FUNCTION public.lucky_draw_on_referral()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _cid uuid;
BEGIN
  IF NEW.referred_by IS NULL OR NEW.referred_by = '' THEN RETURN NEW; END IF;
  SELECT id INTO _cid FROM lucky_draw_campaigns WHERE is_active AND draw_executed_at IS NULL AND now() <= end_at LIMIT 1;
  IF _cid IS NOT NULL THEN
    BEGIN PERFORM lucky_draw_sync_tickets(_cid);
    EXCEPTION WHEN others THEN RAISE WARNING 'lucky draw sync failed: %', SQLERRM; END;
  END IF;
  RETURN NEW;
END $function$;
REVOKE EXECUTE ON FUNCTION public.lucky_draw_on_referral() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_lucky_draw_on_referral ON public.users;
CREATE TRIGGER trg_lucky_draw_on_referral AFTER INSERT OR UPDATE OF referred_by ON public.users
FOR EACH ROW EXECUTE FUNCTION public.lucky_draw_on_referral();

-- Backfill missing referral tickets for the active campaign
SELECT public.lucky_draw_sync_tickets(id) FROM public.lucky_draw_campaigns WHERE is_active;