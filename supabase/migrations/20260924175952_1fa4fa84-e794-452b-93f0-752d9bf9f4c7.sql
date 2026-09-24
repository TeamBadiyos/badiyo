ALTER TABLE public.courier_vehicle_rates
  ADD COLUMN extra_pickup_fee numeric NOT NULL DEFAULT 0,
  ADD COLUMN extra_drop_fee numeric NOT NULL DEFAULT 0,
  ADD COLUMN max_pickups integer NOT NULL DEFAULT 1 CHECK (max_pickups >= 1),
  ADD COLUMN max_drops integer NOT NULL DEFAULT 1 CHECK (max_drops >= 1),
  ADD COLUMN return_per_km numeric NOT NULL DEFAULT 0;

ALTER TABLE public.courier_orders
  ADD COLUMN pickup_count integer NOT NULL DEFAULT 1,
  ADD COLUMN drop_count integer NOT NULL DEFAULT 1,
  ADD COLUMN stops_fee numeric NOT NULL DEFAULT 0;

CREATE TABLE public.courier_order_stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.courier_orders(id) ON DELETE CASCADE,
  stop_type text NOT NULL CHECK (stop_type IN ('pickup','drop','return')),
  sequence integer NOT NULL,
  lat numeric NOT NULL, lng numeric NOT NULL, address text NOT NULL,
  contact_name text NOT NULL, contact_phone text NOT NULL,
  contact_edit_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','arrived','completed','failed','cancelled')),
  arrived_at timestamptz, completed_at timestamptz, failed_at timestamptz, fail_reason_code text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, sequence)
);
CREATE INDEX idx_courier_order_stops_order ON public.courier_order_stops(order_id);
GRANT SELECT ON public.courier_order_stops TO authenticated;
GRANT ALL ON public.courier_order_stops TO service_role;
ALTER TABLE public.courier_order_stops ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.courier_stop_secrets (
  stop_id uuid PRIMARY KEY REFERENCES public.courier_order_stops(id) ON DELETE CASCADE,
  otp_hash text, otp_expires_at timestamptz, otp_issued_at timestamptz,
  attempts integer NOT NULL DEFAULT 0, send_count integer NOT NULL DEFAULT 0,
  last_sent_at timestamptz, verified_at timestamptz, locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.courier_stop_secrets TO service_role;
ALTER TABLE public.courier_stop_secrets ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.courier_order_parcels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.courier_orders(id) ON DELETE CASCADE,
  pickup_stop_id uuid NOT NULL REFERENCES public.courier_order_stops(id),
  drop_stop_id uuid NOT NULL REFERENCES public.courier_order_stops(id),
  return_stop_id uuid REFERENCES public.courier_order_stops(id),
  description text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','picked','delivered','cancelled','returning','returned')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_courier_order_parcels_order ON public.courier_order_parcels(order_id);
GRANT SELECT ON public.courier_order_parcels TO authenticated;
GRANT ALL ON public.courier_order_parcels TO service_role;
ALTER TABLE public.courier_order_parcels ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.courier_order_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.courier_orders(id) ON DELETE CASCADE,
  parcel_id uuid REFERENCES public.courier_order_parcels(id),
  charge_type text NOT NULL CHECK (charge_type IN ('return')),
  distance_km numeric NOT NULL DEFAULT 0, amount numeric NOT NULL,
  gst_percent numeric NOT NULL DEFAULT 0, gst_amount numeric NOT NULL DEFAULT 0,
  total_amount numeric NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','waived')),
  razorpay_order_id text, razorpay_payment_id text, paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_courier_order_charges_order ON public.courier_order_charges(order_id);
GRANT SELECT ON public.courier_order_charges TO authenticated;
GRANT ALL ON public.courier_order_charges TO service_role;
ALTER TABLE public.courier_order_charges ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_courier_order_stops_updated BEFORE UPDATE ON public.courier_order_stops FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_courier_stop_secrets_updated BEFORE UPDATE ON public.courier_stop_secrets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_courier_order_parcels_updated BEFORE UPDATE ON public.courier_order_parcels FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_courier_order_charges_updated BEFORE UPDATE ON public.courier_order_charges FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.courier_can_read_order(_order_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.courier_orders o WHERE o.id = _order_id AND (
      o.customer_id = auth.uid()
      OR (o.assigned_expert_id IS NOT NULL AND o.assigned_expert_id = public.get_expert_id_for_auth(auth.uid()))
      OR public.courier_is_ops_staff()
    ))
$$;
REVOKE EXECUTE ON FUNCTION public.courier_can_read_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.courier_can_read_order(uuid) TO authenticated, service_role;

CREATE POLICY "stops read like order" ON public.courier_order_stops FOR SELECT TO authenticated USING (public.courier_can_read_order(order_id));
CREATE POLICY "parcels read like order" ON public.courier_order_parcels FOR SELECT TO authenticated USING (public.courier_can_read_order(order_id));
CREATE POLICY "charges read like order" ON public.courier_order_charges FOR SELECT TO authenticated USING (public.courier_can_read_order(order_id));

CREATE OR REPLACE FUNCTION public.courier_parcels_validate()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM courier_order_stops WHERE id = NEW.pickup_stop_id AND order_id = NEW.order_id AND stop_type = 'pickup') THEN
    RAISE EXCEPTION 'pickup_stop_id must be a pickup stop of the same order';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM courier_order_stops WHERE id = NEW.drop_stop_id AND order_id = NEW.order_id AND stop_type = 'drop') THEN
    RAISE EXCEPTION 'drop_stop_id must be a drop stop of the same order';
  END IF;
  IF NEW.return_stop_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM courier_order_stops WHERE id = NEW.return_stop_id AND order_id = NEW.order_id AND stop_type = 'return') THEN
    RAISE EXCEPTION 'return_stop_id must be a return stop of the same order';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_courier_parcels_validate BEFORE INSERT OR UPDATE ON public.courier_order_parcels FOR EACH ROW EXECUTE FUNCTION public.courier_parcels_validate();

CREATE OR REPLACE FUNCTION public.courier_orders_default_stops()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _p uuid; _d uuid;
BEGIN
  IF current_setting('app.courier_skip_default_stops', true) = 'on' THEN RETURN NEW; END IF;
  INSERT INTO courier_order_stops(order_id, stop_type, sequence, lat, lng, address, contact_name, contact_phone)
  VALUES (NEW.id, 'pickup', 1, COALESCE(NEW.pickup_lat,0), COALESCE(NEW.pickup_lng,0), COALESCE(NEW.pickup_address,''), COALESCE(NEW.pickup_contact_name,''), COALESCE(NEW.pickup_contact_phone,''))
  RETURNING id INTO _p;
  INSERT INTO courier_order_stops(order_id, stop_type, sequence, lat, lng, address, contact_name, contact_phone)
  VALUES (NEW.id, 'drop', 2, COALESCE(NEW.drop_lat,0), COALESCE(NEW.drop_lng,0), COALESCE(NEW.drop_address,''), COALESCE(NEW.drop_contact_name,''), COALESCE(NEW.drop_contact_phone,''))
  RETURNING id INTO _d;
  INSERT INTO courier_order_parcels(order_id, pickup_stop_id, drop_stop_id, description)
  VALUES (NEW.id, _p, _d, NEW.package_description);
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.courier_orders_default_stops() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_courier_orders_default_stops AFTER INSERT ON public.courier_orders FOR EACH ROW EXECUTE FUNCTION public.courier_orders_default_stops();

-- Backfill (inserts only into new tables)
DO $$
DECLARE o record; _p uuid; _d uuid;
BEGIN
  FOR o IN SELECT * FROM public.courier_orders c WHERE NOT EXISTS (SELECT 1 FROM public.courier_order_stops s WHERE s.order_id = c.id) LOOP
    INSERT INTO public.courier_order_stops(order_id, stop_type, sequence, lat, lng, address, contact_name, contact_phone, status, arrived_at, completed_at)
    VALUES (o.id, 'pickup', 1, COALESCE(o.pickup_lat,0), COALESCE(o.pickup_lng,0), COALESCE(o.pickup_address,''), COALESCE(o.pickup_contact_name,''), COALESCE(o.pickup_contact_phone,''),
      CASE WHEN o.picked_up_at IS NOT NULL THEN 'completed' WHEN o.status='ARRIVED_PICKUP' THEN 'arrived' WHEN o.status='CANCELLED' THEN 'cancelled' ELSE 'pending' END,
      o.arrived_pickup_at, o.picked_up_at)
    RETURNING id INTO _p;
    INSERT INTO public.courier_order_stops(order_id, stop_type, sequence, lat, lng, address, contact_name, contact_phone, status, completed_at, failed_at, fail_reason_code)
    VALUES (o.id, 'drop', 2, COALESCE(o.drop_lat,0), COALESCE(o.drop_lng,0), COALESCE(o.drop_address,''), COALESCE(o.drop_contact_name,''), COALESCE(o.drop_contact_phone,''),
      CASE WHEN o.delivered_at IS NOT NULL THEN 'completed' WHEN o.status='FAILED_DELIVERY' THEN 'failed' WHEN o.status='CANCELLED' THEN 'cancelled' ELSE 'pending' END,
      o.delivered_at,
      CASE WHEN o.delivered_at IS NULL AND o.status='FAILED_DELIVERY' THEN o.updated_at END,
      CASE WHEN o.delivered_at IS NULL AND o.status='FAILED_DELIVERY' THEN o.incident_code END)
    RETURNING id INTO _d;
    INSERT INTO public.courier_order_parcels(order_id, pickup_stop_id, drop_stop_id, description, status)
    VALUES (o.id, _p, _d, o.package_description,
      CASE WHEN o.delivered_at IS NOT NULL THEN 'delivered'
           WHEN o.status='FAILED_DELIVERY' THEN 'pending'
           WHEN o.picked_up_at IS NOT NULL THEN 'picked'
           WHEN o.status='CANCELLED' THEN 'cancelled' ELSE 'pending' END);
  END LOOP;
END $$;