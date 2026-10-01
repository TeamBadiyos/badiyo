CREATE OR REPLACE FUNCTION public.partner_skills_mirror_festival()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _home uuid := '508641a3-59fd-457c-be6a-74879be354cc';
  _fest uuid := '52685ec0-8466-4b6d-a85a-c1fa3ce1f8ea';
BEGIN
  IF NEW.service_category_id = _home AND NEW.status = 'approved' THEN
    INSERT INTO public.partner_skills (expert_id, service_category_id, status, approved_at, approved_by)
    VALUES (NEW.expert_id, _fest, 'approved', COALESCE(NEW.approved_at, now()), NEW.approved_by)
    ON CONFLICT DO NOTHING;

    UPDATE public.partner_skills
       SET status = 'approved',
           approved_at = COALESCE(approved_at, now())
     WHERE expert_id = NEW.expert_id
       AND service_category_id = _fest
       AND status <> 'approved';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_partner_skills_mirror_festival ON public.partner_skills;
CREATE TRIGGER trg_partner_skills_mirror_festival
AFTER INSERT OR UPDATE OF status ON public.partner_skills
FOR EACH ROW
EXECUTE FUNCTION public.partner_skills_mirror_festival();