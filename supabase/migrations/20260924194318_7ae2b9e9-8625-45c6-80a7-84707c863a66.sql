CREATE OR REPLACE FUNCTION public.expert_get_booking_customer(_booking_id uuid)
RETURNS TABLE(full_name text, phone text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT u.full_name, u.phone
  FROM public.bookings b
  JOIN public.users u ON u.id = b.user_id
  WHERE b.id = _booking_id
    AND public.get_expert_id_for_auth(auth.uid()) = b.assigned_expert_id
    AND (
      b.status NOT IN ('completed', 'cancelled')
      OR b.updated_at > now() - interval '24 hours'
    )
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.expert_get_booking_customer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expert_get_booking_customer(uuid) TO authenticated, service_role;