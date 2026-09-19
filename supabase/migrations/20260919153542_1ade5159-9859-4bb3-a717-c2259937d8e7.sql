
ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_message_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS unread_for_customer boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.support_ticket_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  sender_type text NOT NULL CHECK (sender_type IN ('customer','staff')),
  sender_id uuid,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_ticket_messages_ticket_idx
  ON public.support_ticket_messages (ticket_id, created_at);
CREATE INDEX IF NOT EXISTS support_tickets_user_idx
  ON public.support_tickets (user_id, last_message_at DESC);

GRANT SELECT, INSERT ON public.support_ticket_messages TO authenticated;
GRANT ALL ON public.support_ticket_messages TO service_role;

ALTER TABLE public.support_ticket_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view messages of own tickets" ON public.support_ticket_messages;
CREATE POLICY "Users can view messages of own tickets"
ON public.support_ticket_messages FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = ticket_id AND t.user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can write on own tickets" ON public.support_ticket_messages;
CREATE POLICY "Users can write on own tickets"
ON public.support_ticket_messages FOR INSERT TO authenticated
WITH CHECK (
  sender_type = 'customer'
  AND sender_id = auth.uid()
  AND EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = ticket_id AND t.user_id = auth.uid())
);

DROP POLICY IF EXISTS "Staff can view all ticket messages" ON public.support_ticket_messages;
CREATE POLICY "Staff can view all ticket messages"
ON public.support_ticket_messages FOR SELECT TO authenticated
USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));

DROP POLICY IF EXISTS "Staff can reply to tickets" ON public.support_ticket_messages;
CREATE POLICY "Staff can reply to tickets"
ON public.support_ticket_messages FOR INSERT TO authenticated
WITH CHECK (
  sender_type = 'staff'
  AND public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager'])
);

CREATE OR REPLACE FUNCTION public.support_ticket_message_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _ticket public.support_tickets%ROWTYPE;
BEGIN
  SELECT * INTO _ticket FROM public.support_tickets WHERE id = NEW.ticket_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF NEW.sender_type = 'staff' THEN
    UPDATE public.support_tickets
       SET last_message_at = NEW.created_at,
           updated_at = now(),
           unread_for_customer = true,
           status = CASE WHEN status = 'resolved' THEN status ELSE 'answered' END
     WHERE id = NEW.ticket_id;

    BEGIN
      PERFORM public.notify_push_event(
        'customer', _ticket.user_id, 'support_reply',
        'badiyos Support replied',
        left(NEW.body, 120),
        jsonb_build_object('ticket_id', NEW.ticket_id, 'route', 'support')
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[support reply notify] %', SQLERRM;
    END;
  ELSE
    UPDATE public.support_tickets
       SET last_message_at = NEW.created_at,
           updated_at = now(),
           unread_for_customer = false,
           status = CASE WHEN status IN ('resolved','answered') THEN 'open' ELSE status END
     WHERE id = NEW.ticket_id;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_support_ticket_message_after_insert ON public.support_ticket_messages;
CREATE TRIGGER trg_support_ticket_message_after_insert
AFTER INSERT ON public.support_ticket_messages
FOR EACH ROW EXECUTE FUNCTION public.support_ticket_message_after_insert();

CREATE OR REPLACE FUNCTION public.support_mark_ticket_read(_ticket_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  UPDATE public.support_tickets
     SET unread_for_customer = false
   WHERE id = _ticket_id AND user_id = auth.uid();
END $$;

REVOKE ALL ON FUNCTION public.support_mark_ticket_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_mark_ticket_read(uuid) TO authenticated, service_role;
