CREATE TABLE IF NOT EXISTS public.coin_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  razorpay_order_id text NOT NULL UNIQUE,
  coins integer NOT NULL CHECK (coins >= 0),
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','released')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.coin_redemptions TO authenticated;
GRANT ALL ON public.coin_redemptions TO service_role;

ALTER TABLE public.coin_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own coin redemptions" ON public.coin_redemptions;
CREATE POLICY "Users can view their own coin redemptions"
  ON public.coin_redemptions FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.set_updated_at_coin_redemptions()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_coin_redemptions_updated_at ON public.coin_redemptions;
CREATE TRIGGER trg_coin_redemptions_updated_at
  BEFORE UPDATE ON public.coin_redemptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_coin_redemptions();

-- Reserve (debit) coins for a pending payment. Returns coins actually reserved.
CREATE OR REPLACE FUNCTION public.system_coins_reserve(
  _user_id uuid,
  _order_id text,
  _coins integer
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _balance integer := 0;
  _take integer := 0;
  _existing integer;
BEGIN
  IF _user_id IS NULL OR _order_id IS NULL OR COALESCE(_coins,0) <= 0 THEN
    RETURN 0;
  END IF;

  SELECT coins INTO _existing
  FROM public.coin_redemptions
  WHERE razorpay_order_id = _order_id AND status = 'reserved';
  IF _existing IS NOT NULL THEN
    RETURN _existing;
  END IF;

  SELECT COALESCE(total_coins_earned,0) INTO _balance
  FROM public.users WHERE id = _user_id FOR UPDATE;

  _take := LEAST(_coins, GREATEST(_balance, 0));
  IF _take <= 0 THEN RETURN 0; END IF;

  UPDATE public.users
     SET total_coins_earned = GREATEST(COALESCE(total_coins_earned,0) - _take, 0)
   WHERE id = _user_id;

  INSERT INTO public.coin_redemptions(user_id, razorpay_order_id, coins, status)
  VALUES (_user_id, _order_id, _take, 'reserved');

  INSERT INTO public.wallet_transactions(user_id, amount, type, description)
  VALUES (_user_id, _take, 'debit', 'Coins used on a booking payment');

  RETURN _take;
END; $$;

REVOKE ALL ON FUNCTION public.system_coins_reserve(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.system_coins_reserve(uuid, text, integer) TO service_role;

-- Give coins back when a payment is cancelled/failed.
CREATE OR REPLACE FUNCTION public.system_coins_release(_order_id text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r record;
BEGIN
  SELECT * INTO _r FROM public.coin_redemptions
   WHERE razorpay_order_id = _order_id AND status = 'reserved'
   FOR UPDATE;
  IF _r IS NULL THEN RETURN 0; END IF;

  UPDATE public.coin_redemptions SET status = 'released' WHERE id = _r.id;

  UPDATE public.users
     SET total_coins_earned = COALESCE(total_coins_earned,0) + _r.coins
   WHERE id = _r.user_id;

  INSERT INTO public.wallet_transactions(user_id, amount, type, description)
  VALUES (_r.user_id, _r.coins, 'credit', 'Coins returned — booking payment not completed');

  RETURN _r.coins;
END; $$;

REVOKE ALL ON FUNCTION public.system_coins_release(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.system_coins_release(text) TO service_role;

-- Customer-callable: release only my own reservation.
CREATE OR REPLACE FUNCTION public.release_my_coin_redemption(_order_id text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _owner uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN 0; END IF;
  SELECT user_id INTO _owner FROM public.coin_redemptions
   WHERE razorpay_order_id = _order_id AND status = 'reserved';
  IF _owner IS NULL OR _owner <> auth.uid() THEN RETURN 0; END IF;
  RETURN public.system_coins_release(_order_id);
END; $$;

REVOKE ALL ON FUNCTION public.release_my_coin_redemption(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_my_coin_redemption(text) TO authenticated, service_role;

-- Customer-callable: my current coin balance.
CREATE OR REPLACE FUNCTION public.my_coin_balance()
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(total_coins_earned, 0)::int
  FROM public.users WHERE id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.my_coin_balance() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_coin_balance() TO authenticated, service_role;