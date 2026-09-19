-- ============ helpers ============
create or replace function public.courier_is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_active_staff(auth.uid(), array['super_admin'])
$$;

create or replace function public.courier_is_ops_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_active_staff(auth.uid(), array['super_admin','ops_manager'])
$$;

revoke execute on function public.courier_is_super_admin() from public, anon;
revoke execute on function public.courier_is_ops_staff() from public, anon;
grant execute on function public.courier_is_super_admin() to authenticated, service_role;
grant execute on function public.courier_is_ops_staff() to authenticated, service_role;

-- ============ 1. service_flags ============
create table public.service_flags (
  id uuid primary key default gen_random_uuid(),
  service_key text not null,
  city text not null,
  is_active boolean not null default true,
  label text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service_key, city)
);

grant select on public.service_flags to anon, authenticated;
grant all on public.service_flags to service_role;
alter table public.service_flags enable row level security;

create policy "service_flags public read active"
  on public.service_flags for select to anon, authenticated using (is_active = true);
create policy "service_flags staff read"
  on public.service_flags for select to authenticated using (public.courier_is_ops_staff());
create policy "service_flags super admin write"
  on public.service_flags for all to authenticated
  using (public.courier_is_super_admin()) with check (public.courier_is_super_admin());

create trigger trg_service_flags_updated_at before update on public.service_flags
  for each row execute function public.update_updated_at_column();

insert into public.service_flags (service_key, city, is_active, label, sort_order) values
  ('clean',   'Latur', true,  'badiyos Clean', 1),
  ('store',   'Latur', true,  'badiyos Store', 2),
  ('courier', 'Latur', false, 'badiyos Courier', 3);

-- ============ courier rider skill category ============
insert into public.segments (name, slug, vertical_type, display_template, rank, is_active, short_name)
values ('badiyos Courier', 'courier', 'SERVICE', 'CATEGORY_FIRST', 90, false, 'Courier')
on conflict (slug) do nothing;

insert into public.service_categories (segment_id, name, slug, rank, is_active)
select s.id, 'Courier Delivery', 'courier-delivery', 1, false
from public.segments s where s.slug = 'courier'
on conflict do nothing;

-- ============ 2. courier_vehicle_types ============
create table public.courier_vehicle_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  icon text,
  is_active boolean not null default false,
  sort_order integer not null default 0,
  max_weight_kg numeric not null default 20,
  inclusions text[] not null default '{}',
  exclusions text[] not null default '{}',
  required_skill uuid references public.service_categories(id),
  required_documents text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select on public.courier_vehicle_types to anon, authenticated;
grant all on public.courier_vehicle_types to service_role;
alter table public.courier_vehicle_types enable row level security;

create policy "vehicle types public read active"
  on public.courier_vehicle_types for select to anon, authenticated using (is_active = true);
create policy "vehicle types staff read"
  on public.courier_vehicle_types for select to authenticated using (public.courier_is_ops_staff());
create policy "vehicle types super admin write"
  on public.courier_vehicle_types for all to authenticated
  using (public.courier_is_super_admin()) with check (public.courier_is_super_admin());

create trigger trg_courier_vehicle_types_updated_at before update on public.courier_vehicle_types
  for each row execute function public.update_updated_at_column();

insert into public.courier_vehicle_types
  (name, icon, is_active, sort_order, max_weight_kg, inclusions, exclusions, required_skill, required_documents)
select 'Bike / Moped', 'bike', false, 1, 20,
  array['Documents','Small parcels','Food packets','Medicines'],
  array['Furniture','Large appliances','Items above 20 kg','Illegal or prohibited goods'],
  sc.id,
  array['driving_licence','vehicle_rc','aadhaar']
from public.service_categories sc where sc.slug = 'courier-delivery';

-- ============ 3. courier_vehicle_rates ============
create table public.courier_vehicle_rates (
  id uuid primary key default gen_random_uuid(),
  city text not null,
  vehicle_type_id uuid not null references public.courier_vehicle_types(id) on delete cascade,
  base_fare numeric not null default 0,
  included_km numeric not null default 0,
  per_km numeric not null default 0,
  min_fare numeric not null default 0,
  platform_fee numeric not null default 0,
  commission_pct numeric not null default 0,
  is_placeholder boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (city, vehicle_type_id)
);

grant select on public.courier_vehicle_rates to authenticated;
grant all on public.courier_vehicle_rates to service_role;
alter table public.courier_vehicle_rates enable row level security;

create policy "rates staff read"
  on public.courier_vehicle_rates for select to authenticated using (public.courier_is_ops_staff());
create policy "rates super admin write"
  on public.courier_vehicle_rates for all to authenticated
  using (public.courier_is_super_admin()) with check (public.courier_is_super_admin());

create trigger trg_courier_vehicle_rates_updated_at before update on public.courier_vehicle_rates
  for each row execute function public.update_updated_at_column();

insert into public.courier_vehicle_rates
  (city, vehicle_type_id, base_fare, included_km, per_km, min_fare, platform_fee, commission_pct, is_placeholder)
select 'Latur', v.id, 25, 2, 8, 30, 5, 20, true
from public.courier_vehicle_types v where v.name = 'Bike / Moped';

-- ============ 4. courier_types + mapping ============
create table public.courier_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  icon text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  extra_fee numeric not null default 0,
  instructions text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select on public.courier_types to anon, authenticated;
grant all on public.courier_types to service_role;
alter table public.courier_types enable row level security;

create policy "courier types public read active"
  on public.courier_types for select to anon, authenticated using (is_active = true);
create policy "courier types staff read"
  on public.courier_types for select to authenticated using (public.courier_is_ops_staff());
create policy "courier types super admin write"
  on public.courier_types for all to authenticated
  using (public.courier_is_super_admin()) with check (public.courier_is_super_admin());

create trigger trg_courier_types_updated_at before update on public.courier_types
  for each row execute function public.update_updated_at_column();

insert into public.courier_types (name, icon, sort_order, extra_fee, instructions) values
  ('Document', 'file-text', 1, 0,  'Keep documents in a waterproof envelope.'),
  ('Food',     'utensils',  2, 10, 'Pack food spill-proof. Deliver within 30 minutes.'),
  ('Grocery',  'shopping-basket', 3, 0, 'Max weight applies. Fragile items must be packed.'),
  ('Medicine', 'pill',      4, 0,  'Carry the prescription copy if required.'),
  ('Other',    'package',   5, 0,  'Prohibited and illegal items are not allowed.');

create table public.courier_vehicle_courier_types (
  id uuid primary key default gen_random_uuid(),
  vehicle_type_id uuid not null references public.courier_vehicle_types(id) on delete cascade,
  courier_type_id uuid not null references public.courier_types(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (vehicle_type_id, courier_type_id)
);

grant select on public.courier_vehicle_courier_types to anon, authenticated;
grant all on public.courier_vehicle_courier_types to service_role;
alter table public.courier_vehicle_courier_types enable row level security;

create policy "vehicle courier types public read active"
  on public.courier_vehicle_courier_types for select to anon, authenticated using (is_active = true);
create policy "vehicle courier types staff read"
  on public.courier_vehicle_courier_types for select to authenticated using (public.courier_is_ops_staff());
create policy "vehicle courier types super admin write"
  on public.courier_vehicle_courier_types for all to authenticated
  using (public.courier_is_super_admin()) with check (public.courier_is_super_admin());

insert into public.courier_vehicle_courier_types (vehicle_type_id, courier_type_id)
select v.id, t.id from public.courier_vehicle_types v cross join public.courier_types t
where v.name = 'Bike / Moped';

-- ============ ops settings ============
insert into public.ops_settings (key, value, label) values
  ('courier_cancel_fee_arrived',       '30',  'Courier: cancellation fee (Rs) once rider has reached pickup'),
  ('courier_cancel_fee_max_pct',       '50',  'Courier: cancellation fee cap as % of base fare'),
  ('courier_quote_ttl_minutes',        '10',  'Courier: how long a fare quote stays valid (minutes)'),
  ('courier_unpaid_expire_minutes',    '15',  'Courier: auto-expire unpaid orders after (minutes)'),
  ('courier_offer_timeout_seconds',    '30',  'Courier: rider offer timeout (seconds)'),
  ('courier_search_timeout_minutes',   '5',   'Courier: cancel + refund if no rider found within (minutes)'),
  ('courier_geofence_meters',          '200', 'Courier: rider must be within this distance to mark arrived (metres)'),
  ('courier_rider_cancel_cap',         '3',   'Courier: max rider cancellations before order goes to ops'),
  ('courier_failed_delivery_payout_pct','50', 'Courier: rider payout % of base fare on failed delivery'),
  ('courier_slot_buffer_minutes',      '90',  'Courier: skip riders with a home-service slot within (minutes)'),
  ('courier_quote_rate_limit_per_min', '10',  'Courier: max fare quotes per customer per minute'),
  ('courier_settlement_delay_minutes', '0',   'Courier: delay before a delivered order is completed and rider paid'),
  ('courier_road_factor',              '1.3', 'Courier: fallback multiplier on straight-line distance')
on conflict (key) do nothing;

-- ============ Vault OTP secret (randomly generated) ============
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'courier_otp_hmac_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'courier_otp_hmac_key',
      'HMAC key used to derive courier pickup/delivery OTPs'
    );
  end if;
end $$;