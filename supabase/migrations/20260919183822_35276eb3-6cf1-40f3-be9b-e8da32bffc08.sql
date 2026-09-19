
CREATE OR REPLACE FUNCTION public.admin_alert_claim_batch(_limit int DEFAULT 20)
RETURNS TABLE (id uuid, order_type text, order_id uuid, v_order text, v_customer text, v_amount text, v_time text, attempts int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _recent int;
  _room int;
BEGIN
  SELECT count(*) INTO _recent
    FROM public.admin_alert_queue
   WHERE sent_at > now() - interval '1 minute';

  _room := least(coalesce(_limit, 20), 20 - _recent);
  IF _room <= 0 THEN RETURN; END IF;

  RETURN QUERY
  WITH picked AS (
    SELECT q.id
      FROM public.admin_alert_queue q
     WHERE q.status = 'pending'
       AND q.next_attempt_at <= now()
     ORDER BY q.created_at
     FOR UPDATE SKIP LOCKED
     LIMIT _room
  )
  UPDATE public.admin_alert_queue q
     SET status = 'processing',
         attempts = q.attempts + 1,
         updated_at = now()
    FROM picked p
   WHERE q.id = p.id
  RETURNING q.id, q.order_type, q.order_id, q.v_order, q.v_customer, q.v_amount, q.v_time, q.attempts;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_alert_claim_batch(int) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_alert_claim_batch(int) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_alert_mark(_id uuid, _ok boolean, _error text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _row public.admin_alert_queue;
BEGIN
  SELECT * INTO _row FROM public.admin_alert_queue WHERE id = _id;
  IF _row.id IS NULL THEN RETURN; END IF;

  IF _ok THEN
    UPDATE public.admin_alert_queue
       SET status = 'sent', sent_at = now(), last_error = NULL, updated_at = now()
     WHERE id = _id;
    INSERT INTO public.admin_alert_log (order_type, order_id, status, error)
    VALUES (_row.order_type, _row.order_id, 'sent', NULL);
  ELSIF _row.attempts >= 3 THEN
    UPDATE public.admin_alert_queue
       SET status = 'failed', last_error = left(coalesce(_error, ''), 500), updated_at = now()
     WHERE id = _id;
    INSERT INTO public.admin_alert_log (order_type, order_id, status, error)
    VALUES (_row.order_type, _row.order_id, 'failed', left(coalesce(_error, ''), 500));
  ELSE
    UPDATE public.admin_alert_queue
       SET status = 'pending',
           last_error = left(coalesce(_error, ''), 500),
           next_attempt_at = now() + (_row.attempts * interval '2 minutes'),
           updated_at = now()
     WHERE id = _id;
    INSERT INTO public.admin_alert_log (order_type, order_id, status, error)
    VALUES (_row.order_type, _row.order_id, 'retry', left(coalesce(_error, ''), 500));
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_alert_mark(uuid, boolean, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_alert_mark(uuid, boolean, text) TO service_role;
