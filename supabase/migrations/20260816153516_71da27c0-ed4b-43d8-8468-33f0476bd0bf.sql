CREATE TABLE public.task_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  inclusions text[] not null default '{}',
  exclusions text[] not null default '{}',
  rank integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

GRANT SELECT ON public.task_types TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_types TO authenticated;
GRANT ALL ON public.task_types TO service_role;

ALTER TABLE public.task_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "task types public read active" ON public.task_types
  FOR SELECT TO anon, authenticated USING (is_active);
CREATE POLICY "task types staff read" ON public.task_types
  FOR SELECT TO authenticated USING (is_active_staff(auth.uid(), NULL::text[]));
CREATE POLICY "task types staff write" ON public.task_types
  FOR ALL TO authenticated
  USING (is_active_staff(auth.uid(), ARRAY['super_admin'::text,'ops_manager'::text]))
  WITH CHECK (is_active_staff(auth.uid(), ARRAY['super_admin'::text,'ops_manager'::text]));

CREATE TABLE public.item_task_types (
  id uuid primary key default gen_random_uuid(),
  price_option_id uuid not null references public.service_price_options(id) on delete cascade,
  task_type_id uuid not null references public.task_types(id) on delete cascade,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (price_option_id, task_type_id)
);

CREATE INDEX item_task_types_price_option_idx ON public.item_task_types(price_option_id);

GRANT SELECT ON public.item_task_types TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.item_task_types TO authenticated;
GRANT ALL ON public.item_task_types TO service_role;

ALTER TABLE public.item_task_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "item task types public read" ON public.item_task_types
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "item task types staff write" ON public.item_task_types
  FOR ALL TO authenticated
  USING (is_active_staff(auth.uid(), ARRAY['super_admin'::text,'ops_manager'::text]))
  WITH CHECK (is_active_staff(auth.uid(), ARRAY['super_admin'::text,'ops_manager'::text]));