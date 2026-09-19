-- ============ courier_orders ============
create table public.courier_orders (
  id uuid primary key default gen_random_uuid(),
  order_code text not null unique default upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)),
  customer_id uuid not null,
  city text not null,
  vehicle_type_id uuid not null references public.courier_vehicle_types(id),
  courier_type_id uuid not null references public.courier_types(id),

  pickup_lat numeric not null,
  pickup_lng numeric not null,
  pickup_address text not null,
  pickup_contact_name text not null,
  pickup_contact_phone text not null,
  drop_lat numeric not null,
  drop_lng numeric not null,
  drop_address text not null,
  drop_contact_name text not null,
  drop_contact_phone text not null,

  package_description text,
  weight_kg numeric not null default 0,
  prohibited_items_confirmed boolean not null default false,

  distance_km numeric not null default 0,
  distance_source text not null default 'routes',
  fare_breakdown jsonb not null default '{}'::jsonb,
  quote_expires_at timestamptz,

  base_amount numeric not null default 0,
  extra_fee numeric not null default 0,
  platform_fee numeric not null default 0,
  discount_amount numeric not null default 0,
  coupon_id uuid references public.coupons(id),
  coupon_code text,
  wallet_amount numeric not null default 0,
  gst_percent numeric not null default 0,
  gst_amount numeric not null default 0,
  total_amount numeric not null default 0,
  commission_pct numeric not null default 0,

  razorpay_order_id text,
  razorpay_payment_id text,
  payment_status text not null default 'pending'
    check (payment_status in ('pending','paid','failed','refund_pending','refunded','partially_refunded')),
  refund_status text not null default 'none'
    check (refund_status in ('none','refund_pending','processing','done','failed')),
  refund_amount numeric not null default 0,
  refund_id text,
  refund_attempts integer not null default 0,
  refund_next_attempt_at timestamptz,
  refund_reason text,

  status text not null default 'REQUESTED'
    check (status in ('REQUESTED','SEARCHING','DRIVER_ASSIGNED','ARRIVED_PICKUP','PICKED_UP','IN_TRANSIT','DELIVERED','COMPLETED','CANCELLED','FAILED_DELIVERY')),
  assigned_expert_id uuid references public.experts(id),
  rider_cancel_count integer not null default 0,
  otp_attempts integer not null default 0,
  needs_ops_attention boolean not null default false,

  cancel_reason_code text,
  cancelled_by text check (cancelled_by in ('customer','rider','system','staff')),
  cancellation_fee numeric not null default 0,
  incident_code text,
  incident_notes text,
  incident_resolution text,
  proof_photo_url text,

  current_search_radius_km numeric,
  search_started_at timestamptz,
  assigned_at timestamptz,
  arrived_pickup_at timestamptz,
  picked_up_at timestamptz,
  in_transit_at timestamptz,
  delivered_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  earnings_credited_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_courier_orders_customer on public.courier_orders (customer_id, created_at desc);
create index idx_courier_orders_status on public.courier_orders (status);
create index idx_courier_orders_rider on public.courier_orders (assigned_expert_id) where assigned_expert_id is not null;
create index idx_courier_orders_refund on public.courier_orders (refund_status) where refund_status in ('refund_pending','failed');
create unique index uniq_courier_orders_razorpay on public.courier_orders (razorpay_order_id) where razorpay_order_id is not null;

grant select on public.courier_orders to authenticated;
grant all on public.courier_orders to service_role;
alter table public.courier_orders enable row level security;

create policy "courier orders customer read own"
  on public.courier_orders for select to authenticated using (customer_id = auth.uid());
create policy "courier orders rider read assigned"
  on public.courier_orders for select to authenticated
  using (assigned_expert_id is not null and assigned_expert_id = public.get_expert_id_for_auth(auth.uid()));
create policy "courier orders staff read"
  on public.courier_orders for select to authenticated using (public.courier_is_ops_staff());

create trigger trg_courier_orders_updated_at before update on public.courier_orders
  for each row execute function public.update_updated_at_column();

-- ============ courier_order_secrets (no client access at all) ============
create table public.courier_order_secrets (
  order_id uuid primary key references public.courier_orders(id) on delete cascade,
  pickup_otp_hash text,
  pickup_otp_expires_at timestamptz,
  pickup_otp_issued_at timestamptz,
  pickup_attempts integer not null default 0,
  delivery_otp_hash text,
  delivery_otp_expires_at timestamptz,
  delivery_otp_issued_at timestamptz,
  delivery_attempts integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

revoke all on public.courier_order_secrets from anon, authenticated;
grant all on public.courier_order_secrets to service_role;
alter table public.courier_order_secrets enable row level security;
create policy "courier order secrets deny all"
  on public.courier_order_secrets for all to authenticated, anon using (false) with check (false);

create trigger trg_courier_order_secrets_updated_at before update on public.courier_order_secrets
  for each row execute function public.update_updated_at_column();

-- ============ courier_order_events ============
create table public.courier_order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.courier_orders(id) on delete cascade,
  from_status text,
  to_status text not null,
  actor_type text,
  actor_id uuid,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_courier_order_events_order on public.courier_order_events (order_id, created_at);

grant select on public.courier_order_events to authenticated;
grant all on public.courier_order_events to service_role;
alter table public.courier_order_events enable row level security;

create policy "courier events customer read own"
  on public.courier_order_events for select to authenticated
  using (exists (select 1 from public.courier_orders o where o.id = order_id and o.customer_id = auth.uid()));
create policy "courier events rider read assigned"
  on public.courier_order_events for select to authenticated
  using (exists (select 1 from public.courier_orders o
                 where o.id = order_id
                   and o.assigned_expert_id is not null
                   and o.assigned_expert_id = public.get_expert_id_for_auth(auth.uid())));
create policy "courier events staff read"
  on public.courier_order_events for select to authenticated using (public.courier_is_ops_staff());

-- ============ courier_offers ============
create table public.courier_offers (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.courier_orders(id) on delete cascade,
  expert_id uuid not null references public.experts(id) on delete cascade,
  distance_km numeric,
  sent_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','accepted','rejected','expired','cancelled')),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, expert_id)
);

create index idx_courier_offers_pending on public.courier_offers (status, expires_at) where status = 'pending';
create index idx_courier_offers_expert on public.courier_offers (expert_id, status);

grant select on public.courier_offers to authenticated;
grant all on public.courier_offers to service_role;
alter table public.courier_offers enable row level security;

create policy "courier offers rider read own"
  on public.courier_offers for select to authenticated
  using (expert_id = public.get_expert_id_for_auth(auth.uid()));
create policy "courier offers staff read"
  on public.courier_offers for select to authenticated using (public.courier_is_ops_staff());

create trigger trg_courier_offers_updated_at before update on public.courier_offers
  for each row execute function public.update_updated_at_column();

-- ============ status transition guard + event log ============
create or replace function public.courier_orders_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  _allowed text[];
begin
  if NEW.status = OLD.status then
    return NEW;
  end if;

  _allowed := case OLD.status
    when 'REQUESTED'       then array['SEARCHING','CANCELLED']
    when 'SEARCHING'       then array['DRIVER_ASSIGNED','CANCELLED']
    when 'DRIVER_ASSIGNED' then array['ARRIVED_PICKUP','SEARCHING','CANCELLED']
    when 'ARRIVED_PICKUP'  then array['PICKED_UP','SEARCHING','CANCELLED']
    when 'PICKED_UP'       then array['IN_TRANSIT','FAILED_DELIVERY']
    when 'IN_TRANSIT'      then array['DELIVERED','FAILED_DELIVERY']
    when 'DELIVERED'       then array['COMPLETED']
    when 'FAILED_DELIVERY' then array['COMPLETED','CANCELLED']
    else array[]::text[]
  end;

  if not (NEW.status = any(_allowed)) then
    raise exception 'Invalid courier status transition % -> %', OLD.status, NEW.status;
  end if;

  return NEW;
end $$;

create trigger trg_courier_orders_guard before update of status on public.courier_orders
  for each row execute function public.courier_orders_guard();

create or replace function public.courier_orders_log_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.courier_order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
    values (NEW.id, null, NEW.status, 'customer', NEW.customer_id, '{}'::jsonb);
    insert into public.courier_order_secrets (order_id) values (NEW.id) on conflict do nothing;
  elsif NEW.status is distinct from OLD.status then
    insert into public.courier_order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
    values (NEW.id, OLD.status, NEW.status,
            coalesce(current_setting('app.courier_actor_type', true), 'system'),
            nullif(current_setting('app.courier_actor_id', true), '')::uuid,
            jsonb_build_object('rider', NEW.assigned_expert_id, 'cancel_reason', NEW.cancel_reason_code));
  end if;
  return NEW;
end $$;

create trigger trg_courier_orders_log_insert after insert on public.courier_orders
  for each row execute function public.courier_orders_log_event();
create trigger trg_courier_orders_log_update after update on public.courier_orders
  for each row execute function public.courier_orders_log_event();

revoke execute on function public.courier_orders_guard() from public, anon, authenticated;
revoke execute on function public.courier_orders_log_event() from public, anon, authenticated;