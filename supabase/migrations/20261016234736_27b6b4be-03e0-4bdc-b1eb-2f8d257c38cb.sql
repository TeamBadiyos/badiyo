CREATE OR REPLACE FUNCTION public.courier_apply_wallet(_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _o record; _ws jsonb; _w numeric := 0; _net numeric;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO _o FROM courier_orders WHERE id=_order_id AND customer_id=_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;
  IF coalesce(_o.payment_status,'pending') = 'paid' THEN
    RETURN jsonb_build_object('ok',true,'wallet_used',_o.wallet_amount,'total_amount',_o.total_amount,'paid',true);
  END IF;
  IF coalesce(_o.wallet_amount,0) > 0 THEN
    RETURN jsonb_build_object('ok',true,'wallet_used',_o.wallet_amount,'total_amount',_o.total_amount,'paid',_o.total_amount<=0);
  END IF;
  IF _o.total_amount > 0 THEN
    _ws := wallet_spend(_uid, _o.total_amount, 'payment', 'courier_order', _order_id::text, 'Parcel delivery', false, true);
    _w := coalesce((_ws->>'cash')::numeric,0) + coalesce((_ws->>'bonus')::numeric,0);
  END IF;
  _net := round(_o.total_amount - _w, 2);
  UPDATE courier_orders SET wallet_amount=_w, total_amount=_net, updated_at=now() WHERE id=_order_id;
  RETURN jsonb_build_object('ok',true,'wallet_used',_w,'total_amount',_net,'paid',_net<=0);
END $$;
REVOKE ALL ON FUNCTION public.courier_apply_wallet(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.courier_apply_wallet(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.courier_wallet_return_on_end()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status IN ('CANCELLED','FAILED','EXPIRED') AND NEW.status IS DISTINCT FROM OLD.status
     AND coalesce(NEW.wallet_amount,0) > 0 THEN
    PERFORM wallet_return(NEW.customer_id,'courier_order',NEW.id::text,'Parcel cancelled');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS courier_wallet_return_on_end ON public.courier_orders;
CREATE TRIGGER courier_wallet_return_on_end AFTER UPDATE OF status ON public.courier_orders
FOR EACH ROW EXECUTE FUNCTION public.courier_wallet_return_on_end();