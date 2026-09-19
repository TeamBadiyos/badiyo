-- =========================================================
-- COUPONS
-- =========================================================
CREATE TABLE public.coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  title text NOT NULL DEFAULT '',
  description text,
  discount_type text NOT NULL DEFAULT 'flat',
  discount_value numeric NOT NULL DEFAULT 0,
  max_discount numeric,
  min_order_amount numeric NOT NULL DEFAULT 0,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  total_usage_limit integer,
  per_user_limit integer NOT NULL DEFAULT 1,
  used_count integer NOT NULL DEFAULT 0,
  audience text NOT NULL DEFAULT 'all',
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coupons_code_unique UNIQUE (code),
  CONSTRAINT coupons_discount_type_chk CHECK (discount_type IN ('flat','percent','free_minutes')),
  CONSTRAINT coupons_audience_chk CHECK (audience IN ('all','targeted','referral_reward'))
);

GRANT SELECT ON public.coupons TO authenticated;
GRANT SELECT ON public.coupons TO anon;
GRANT ALL ON public.coupons TO service_role;
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read active public coupons"
  ON public.coupons FOR SELECT
  USING (is_active = true AND audience = 'all');

CREATE POLICY "Staff manage coupons"
  ON public.coupons FOR ALL TO authenticated
  USING (public.is_active_staff(auth.uid(), NULL))
  WITH CHECK (public.is_active_staff(auth.uid(), NULL));

-- =========================================================
-- COUPONS GRANTED TO A SPECIFIC CUSTOMER
-- =========================================================
CREATE TABLE public.customer_coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  coupon_id uuid NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'manual',
  source_ref text,
  status text NOT NULL DEFAULT 'available',
  expires_at timestamptz,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_coupons_status_chk CHECK (status IN ('available','used','expired')),
  CONSTRAINT customer_coupons_unique UNIQUE (user_id, coupon_id)
);

GRANT SELECT ON public.customer_coupons TO authenticated;
GRANT ALL ON public.customer_coupons TO service_role;
ALTER TABLE public.customer_coupons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers read their granted coupons"
  ON public.customer_coupons FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_active_staff(auth.uid(), NULL));

CREATE POLICY "Staff manage granted coupons"
  ON public.customer_coupons FOR ALL TO authenticated
  USING (public.is_active_staff(auth.uid(), NULL))
  WITH CHECK (public.is_active_staff(auth.uid(), NULL));

CREATE POLICY "Customers can read coupons granted to them"
  ON public.coupons FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.customer_coupons cc
     WHERE cc.coupon_id = coupons.id AND cc.user_id = auth.uid()
  ));

-- =========================================================
-- REDEMPTIONS (reservation + use tracking)
-- =========================================================
CREATE TABLE public.coupon_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id uuid NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  razorpay_order_id text,
  discount_amount numeric NOT NULL DEFAULT 0,
  base_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'reserved',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coupon_redemptions_status_chk CHECK (status IN ('reserved','applied','released'))
);

CREATE INDEX coupon_redemptions_order_idx ON public.coupon_redemptions (razorpay_order_id);
CREATE INDEX coupon_redemptions_user_idx ON public.coupon_redemptions (user_id, coupon_id, status);

GRANT SELECT ON public.coupon_redemptions TO authenticated;
GRANT ALL ON public.coupon_redemptions TO service_role;
ALTER TABLE public.coupon_redemptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers read their redemptions"
  ON public.coupon_redemptions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_active_staff(auth.uid(), NULL));

-- =========================================================
-- REFERRAL MILESTONE PROGRAMS
-- =========================================================
CREATE TABLE public.referral_milestone_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  required_referrals integer NOT NULL DEFAULT 3,
  reward_discount_type text NOT NULL DEFAULT 'free_minutes',
  reward_discount_value numeric NOT NULL DEFAULT 60,
  reward_max_discount numeric,
  reward_min_order_amount numeric NOT NULL DEFAULT 0,
  reward_validity_days integer NOT NULL DEFAULT 30,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rmp_reward_type_chk CHECK (reward_discount_type IN ('flat','percent','free_minutes'))
);

GRANT SELECT ON public.referral_milestone_programs TO authenticated;
GRANT SELECT ON public.referral_milestone_programs TO anon;
GRANT ALL ON public.referral_milestone_programs TO service_role;
ALTER TABLE public.referral_milestone_programs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read active milestone programs"
  ON public.referral_milestone_programs FOR SELECT
  USING (is_active = true);

CREATE POLICY "Staff manage milestone programs"
  ON public.referral_milestone_programs FOR ALL TO authenticated
  USING (public.is_active_staff(auth.uid(), NULL))
  WITH CHECK (public.is_active_staff(auth.uid(), NULL));

CREATE TABLE public.referral_milestone_awards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  program_id uuid NOT NULL REFERENCES public.referral_milestone_programs(id) ON DELETE CASCADE,
  coupon_id uuid REFERENCES public.coupons(id) ON DELETE SET NULL,
  referrals_at_award integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rma_unique UNIQUE (user_id, program_id)
);

GRANT SELECT ON public.referral_milestone_awards TO authenticated;
GRANT ALL ON public.referral_milestone_awards TO service_role;
ALTER TABLE public.referral_milestone_awards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers read their milestone awards"
  ON public.referral_milestone_awards FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_active_staff(auth.uid(), NULL));

-- =========================================================
-- MARKETING CAMPAIGNS
-- =========================================================
CREATE TABLE public.marketing_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  image_url text,
  deep_link text,
  coupon_id uuid REFERENCES public.coupons(id) ON DELETE SET NULL,
  audience text NOT NULL DEFAULT 'all',
  status text NOT NULL DEFAULT 'draft',
  show_in_offers boolean NOT NULL DEFAULT true,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  scheduled_at timestamptz,
  sent_at timestamptz,
  recipients_count integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaigns_status_chk CHECK (status IN ('draft','scheduled','sent','cancelled'))
);

GRANT SELECT ON public.marketing_campaigns TO authenticated;
GRANT SELECT ON public.marketing_campaigns TO anon;
GRANT ALL ON public.marketing_campaigns TO service_role;
ALTER TABLE public.marketing_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read live campaigns"
  ON public.marketing_campaigns FOR SELECT
  USING (
    show_in_offers = true
    AND status IN ('scheduled','sent')
    AND starts_at <= now()
    AND (ends_at IS NULL OR ends_at > now())
  );

CREATE POLICY "Staff manage campaigns"
  ON public.marketing_campaigns FOR ALL TO authenticated
  USING (public.is_active_staff(auth.uid(), NULL))
  WITH CHECK (public.is_active_staff(auth.uid(), NULL));

CREATE TABLE public.campaign_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.marketing_campaigns(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_deliveries_unique UNIQUE (campaign_id, user_id)
);

GRANT SELECT ON public.campaign_deliveries TO authenticated;
GRANT ALL ON public.campaign_deliveries TO service_role;
ALTER TABLE public.campaign_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers read their campaign deliveries"
  ON public.campaign_deliveries FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_active_staff(auth.uid(), NULL));

-- =========================================================
-- BOOKINGS: coupon columns
-- =========================================================
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS coupon_id uuid REFERENCES public.coupons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS coupon_code text,
  ADD COLUMN IF NOT EXISTS discount_amount numeric NOT NULL DEFAULT 0;

-- updated_at triggers
CREATE TRIGGER coupons_updated_at BEFORE UPDATE ON public.coupons
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER customer_coupons_updated_at BEFORE UPDATE ON public.customer_coupons
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER coupon_redemptions_updated_at BEFORE UPDATE ON public.coupon_redemptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER referral_milestone_programs_updated_at BEFORE UPDATE ON public.referral_milestone_programs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER marketing_campaigns_updated_at BEFORE UPDATE ON public.marketing_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();