
ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS store_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS delivery_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS delivery_status text NOT NULL DEFAULT 'inactive';
DO $$ BEGIN
  ALTER TABLE public.merchants ADD CONSTRAINT merchants_delivery_status_chk CHECK (delivery_status IN ('inactive','active','suspended'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.merchants_guard_privileged()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
DECLARE v_col text;
BEGIN
  IF current_user NOT IN ('authenticated','anon') OR coalesce(auth.role(),'') = 'service_role' THEN RETURN NEW; END IF;
  IF public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RETURN NEW; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN v_col := 'status';
  ELSIF NEW.commission_type IS DISTINCT FROM OLD.commission_type THEN v_col := 'commission_type';
  ELSIF NEW.commission_value IS DISTINCT FROM OLD.commission_value THEN v_col := 'commission_value';
  ELSIF NEW.fee_tier_id IS DISTINCT FROM OLD.fee_tier_id THEN v_col := 'fee_tier_id';
  ELSIF NEW.zone_id IS DISTINCT FROM OLD.zone_id THEN v_col := 'zone_id';
  ELSIF NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN v_col := 'approved_at';
  ELSIF NEW.approved_by IS DISTINCT FROM OLD.approved_by THEN v_col := 'approved_by';
  ELSIF NEW.onboarded_by IS DISTINCT FROM OLD.onboarded_by THEN v_col := 'onboarded_by';
  ELSIF NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id THEN v_col := 'auth_user_id';
  ELSIF NEW.phone IS DISTINCT FROM OLD.phone THEN v_col := 'phone';
  ELSIF NEW.pin_hash IS DISTINCT FROM OLD.pin_hash THEN v_col := 'pin_hash';
  ELSIF NEW.store_enabled IS DISTINCT FROM OLD.store_enabled THEN v_col := 'store_enabled';
  ELSIF NEW.delivery_enabled IS DISTINCT FROM OLD.delivery_enabled THEN v_col := 'delivery_enabled';
  ELSIF NEW.delivery_status IS DISTINCT FROM OLD.delivery_status THEN v_col := 'delivery_status';
  ELSIF NEW.gst_status IS DISTINCT FROM OLD.gst_status AND OLD.status NOT IN ('draft','rejected') THEN v_col := 'gst_status';
  ELSIF (NEW.store_category_id IS DISTINCT FROM OLD.store_category_id OR NEW.segment_id IS DISTINCT FROM OLD.segment_id)
        AND OLD.status NOT IN ('draft','pending_review','rejected') THEN v_col := 'store_category_id';
  END IF;
  IF v_col IS NOT NULL THEN
    RAISE EXCEPTION 'Not allowed to change % on merchant profile', v_col USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $function$;

-- permission helper (roles store permissions as array or {key:true} object)
CREATE OR REPLACE FUNCTION public.merchant_caller_has_perm(_perm text)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
declare _mid uuid := public.current_merchant_id(); _p jsonb;
begin
  if _mid is null then return false; end if;
  if exists (select 1 from public.merchants where id=_mid and auth_user_id = auth.uid()) then return true; end if;
  select coalesce(r.permissions,'[]'::jsonb) into _p
    from public.merchant_staff ms left join public.merchant_roles r on r.id=ms.role_id
   where ms.auth_user_id=auth.uid() and ms.merchant_id=_mid and ms.status='active' limit 1;
  if _p is null then return false; end if;
  if jsonb_typeof(_p)='object' then return coalesce(_p->_perm,'false'::jsonb)='true'::jsonb; end if;
  return _p ? _perm;
end $$;

CREATE OR REPLACE FUNCTION public.merchant_my_context()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _mid uuid; _owner boolean; _perms jsonb; _m public.merchants%rowtype; _name text;
begin
  _mid := public.current_merchant_id();
  if _mid is null then return jsonb_build_object('merchant_id', null); end if;
  select * into _m from public.merchants where id = _mid;
  _owner := (_m.auth_user_id is not null and _m.auth_user_id = auth.uid());
  if _owner then
    _perms := '["view_orders","manage_orders","manage_products","view_reports","manage_staff","manage_delivery"]'::jsonb;
  else
    select coalesce(r.permissions, '[]'::jsonb), ms.name into _perms, _name
      from public.merchant_staff ms left join public.merchant_roles r on r.id = ms.role_id
     where ms.auth_user_id = auth.uid() and ms.merchant_id = _mid limit 1;
    _perms := coalesce(_perms, '[]'::jsonb);
    if jsonb_typeof(_perms) = 'object' then
      select coalesce(jsonb_agg(e.key), '[]'::jsonb) into _perms from jsonb_each(_perms) e where e.value = 'true'::jsonb;
    end if;
  end if;
  return jsonb_build_object(
    'merchant_id', _mid, 'is_owner', _owner, 'permissions', _perms, 'status', _m.status,
    'store_name', _m.store_name, 'staff_name', _name,
    'store_enabled', _m.store_enabled, 'delivery_enabled', _m.delivery_enabled, 'delivery_status', _m.delivery_status);
end; $function$;

-- claim pre-created rows only when the phone matches the verified sign-in phone
CREATE OR REPLACE FUNCTION public.merchant_ensure_draft(_phone text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_digits text := right(regexp_replace(coalesce(_phone,''), '\D', '', 'g'), 10);
  v_verified text;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT id INTO v_id FROM public.merchants WHERE auth_user_id = v_uid LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  IF v_digits !~ '^[6-9][0-9]{9}$' THEN RAISE EXCEPTION 'Invalid phone number'; END IF;
  v_verified := public.courier_my_phone10();
  IF v_verified IS NOT NULL AND v_verified = v_digits THEN
    SELECT id INTO v_id FROM public.merchants
     WHERE right(regexp_replace(coalesce(phone,''), '\D', '', 'g'),10) = v_digits AND auth_user_id IS NULL
     ORDER BY delivery_enabled DESC, created_at LIMIT 1 FOR UPDATE;
    IF v_id IS NOT NULL THEN
      UPDATE public.merchants SET auth_user_id = v_uid, updated_at = now() WHERE id = v_id;
      RETURN v_id;
    END IF;
  END IF;
  INSERT INTO public.merchants (auth_user_id, phone, status, onboarding_step)
  VALUES (v_uid, v_digits, 'draft', 1) RETURNING id INTO v_id;
  RETURN v_id;
END; $function$;

-- tables
CREATE TABLE public.business_profiles (
  merchant_id uuid PRIMARY KEY REFERENCES public.merchants(id) ON DELETE CASCADE,
  business_name text NOT NULL,
  gstin text,
  city text,
  vehicle_type_id uuid REFERENCES public.courier_vehicle_types(id),
  courier_type_id uuid REFERENCES public.courier_types(id),
  batch_capacity int NOT NULL DEFAULT 10,
  auto_time_enabled boolean NOT NULL DEFAULT false,
  time_slab_minutes int NOT NULL DEFAULT 120,
  auto_qty_enabled boolean NOT NULL DEFAULT false,
  qty_threshold int NOT NULL DEFAULT 10,
  low_balance_threshold numeric NOT NULL DEFAULT 500,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.business_pickup_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  name text NOT NULL, address text NOT NULL, lat numeric NOT NULL, lng numeric NOT NULL,
  contact_name text, contact_phone text,
  is_default boolean NOT NULL DEFAULT false, is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX business_pickup_one_default ON public.business_pickup_points(merchant_id) WHERE is_default;
CREATE TABLE public.business_receivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  name text NOT NULL, contact_name text, contact_phone text NOT NULL,
  address text NOT NULL, lat numeric NOT NULL, lng numeric NOT NULL,
  notes text, is_active boolean NOT NULL DEFAULT true, created_by_label text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX business_receivers_active_phone ON public.business_receivers(merchant_id, contact_phone) WHERE is_active;

GRANT SELECT ON public.business_profiles, public.business_pickup_points, public.business_receivers TO authenticated;
GRANT ALL ON public.business_profiles, public.business_pickup_points, public.business_receivers TO service_role;
ALTER TABLE public.business_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_pickup_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_receivers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "business_profiles read" ON public.business_profiles FOR SELECT TO authenticated
  USING (merchant_id = public.current_merchant_id() OR public.courier_is_ops_staff());
CREATE POLICY "business_pickup read" ON public.business_pickup_points FOR SELECT TO authenticated
  USING (merchant_id = public.current_merchant_id() OR public.courier_is_ops_staff());
CREATE POLICY "business_receivers read" ON public.business_receivers FOR SELECT TO authenticated
  USING (merchant_id = public.current_merchant_id() OR public.courier_is_ops_staff());

CREATE OR REPLACE FUNCTION public.business_touch() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$ begin NEW.updated_at := now(); return NEW; end $$;
CREATE TRIGGER business_profiles_touch BEFORE UPDATE ON public.business_profiles FOR EACH ROW EXECUTE FUNCTION public.business_touch();
CREATE TRIGGER business_pickup_touch BEFORE UPDATE ON public.business_pickup_points FOR EACH ROW EXECUTE FUNCTION public.business_touch();
CREATE TRIGGER business_receivers_touch BEFORE UPDATE ON public.business_receivers FOR EACH ROW EXECUTE FUNCTION public.business_touch();

-- helpers
CREATE OR REPLACE FUNCTION public.business_phone10(_p text) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public'
AS $$ declare d text := right(regexp_replace(coalesce(_p,''),'\D','','g'),10);
begin if d !~ '^[6-9][0-9]{9}$' then raise exception 'Enter a valid 10-digit mobile number'; end if; return d; end $$;

CREATE OR REPLACE FUNCTION public.business_require_delivery() RETURNS uuid
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
declare _mid uuid := public.current_merchant_id(); _m public.merchants%rowtype;
begin
  if auth.uid() is null or _mid is null then raise exception 'Not a merchant' using errcode='42501'; end if;
  select * into _m from public.merchants where id=_mid;
  if not _m.delivery_enabled or _m.delivery_status <> 'active' then
    raise exception 'Delivery is not active for this business' using errcode='42501'; end if;
  if not public.merchant_caller_has_perm('manage_delivery') then
    raise exception 'You do not have permission to manage delivery' using errcode='42501'; end if;
  return _mid;
end $$;

CREATE OR REPLACE FUNCTION public.business_audit(_action text, _table text, _id uuid, _before jsonb, _after jsonb, _actor_label text)
 RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$ insert into public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(), _action, _table, _id, _before, coalesce(_after,'{}'::jsonb) || jsonb_build_object('actor_label', _actor_label)) $$;

CREATE OR REPLACE FUNCTION public.business_check_location(_lat numeric, _lng numeric) RETURNS void
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ begin
  if not coalesce((public.courier_check_serviceability(_lat,_lng)->>'serviceable')::boolean,false) then
    raise exception 'This location is outside our parcel delivery area'; end if;
end $$;

-- internal writers shared by merchant + staff
CREATE OR REPLACE FUNCTION public.business_pickup_write(_mid uuid, _id uuid, _name text, _address text, _lat numeric, _lng numeric,
  _contact_name text, _contact_phone text, _is_default boolean, _is_active boolean, _actor_label text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare _old jsonb; _new public.business_pickup_points; _ph text;
begin
  if coalesce(btrim(_name),'')='' or coalesce(btrim(_address),'')='' then raise exception 'Name and address are required'; end if;
  perform public.business_check_location(_lat,_lng);
  _ph := case when coalesce(btrim(_contact_phone),'')='' then null else public.business_phone10(_contact_phone) end;
  if coalesce(_is_default,false) then
    update public.business_pickup_points set is_default=false where merchant_id=_mid and is_default and id is distinct from _id;
  end if;
  if _id is null then
    insert into public.business_pickup_points(merchant_id,name,address,lat,lng,contact_name,contact_phone,is_default,is_active)
    values (_mid,btrim(_name),btrim(_address),_lat,_lng,_contact_name,_ph,coalesce(_is_default,false),coalesce(_is_active,true))
    returning * into _new;
  else
    select to_jsonb(p) into _old from public.business_pickup_points p where id=_id and merchant_id=_mid for update;
    if _old is null then raise exception 'Pickup point not found'; end if;
    update public.business_pickup_points set name=btrim(_name), address=btrim(_address), lat=_lat, lng=_lng,
      contact_name=_contact_name, contact_phone=_ph, is_default=coalesce(_is_default,is_default), is_active=coalesce(_is_active,is_active)
    where id=_id returning * into _new;
  end if;
  perform public.business_audit('business_upsert_pickup_point','business_pickup_points',_new.id,_old,to_jsonb(_new),_actor_label);
  return _new.id;
end $$;

-- merchant RPCs
CREATE OR REPLACE FUNCTION public.business_get_profile() RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ declare _mid uuid := public.business_require_delivery();
begin
  return jsonb_build_object(
    'profile', (select to_jsonb(b) from public.business_profiles b where merchant_id=_mid),
    'pickup_points', coalesce((select jsonb_agg(to_jsonb(p) order by p.is_default desc, p.created_at) from public.business_pickup_points p where merchant_id=_mid),'[]'::jsonb));
end $$;

CREATE OR REPLACE FUNCTION public.business_upsert_pickup_point(_id uuid, _name text, _address text, _lat numeric, _lng numeric,
  _contact_name text, _contact_phone text, _is_default boolean DEFAULT NULL, _is_active boolean DEFAULT NULL, _actor_label text DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$ begin
  return public.business_pickup_write(public.business_require_delivery(), _id, _name, _address, _lat, _lng, _contact_name, _contact_phone, _is_default, _is_active, _actor_label);
end $$;

CREATE OR REPLACE FUNCTION public.business_upsert_receiver(_id uuid, _name text, _contact_name text, _contact_phone text,
  _address text, _lat numeric, _lng numeric, _notes text DEFAULT NULL, _actor_label text DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare _mid uuid := public.business_require_delivery(); _ph text; _old jsonb; _new public.business_receivers;
begin
  if coalesce(btrim(_name),'')='' or coalesce(btrim(_address),'')='' then raise exception 'Name and address are required'; end if;
  _ph := public.business_phone10(_contact_phone);
  perform public.business_check_location(_lat,_lng);
  if exists (select 1 from public.business_receivers where merchant_id=_mid and contact_phone=_ph and is_active and id is distinct from _id) then
    raise exception 'A receiver with this phone number already exists'; end if;
  if _id is null then
    insert into public.business_receivers(merchant_id,name,contact_name,contact_phone,address,lat,lng,notes,created_by_label)
    values (_mid,btrim(_name),_contact_name,_ph,btrim(_address),_lat,_lng,_notes,_actor_label) returning * into _new;
  else
    select to_jsonb(r) into _old from public.business_receivers r where id=_id and merchant_id=_mid for update;
    if _old is null then raise exception 'Receiver not found'; end if;
    update public.business_receivers set name=btrim(_name), contact_name=_contact_name, contact_phone=_ph,
      address=btrim(_address), lat=_lat, lng=_lng, notes=_notes where id=_id returning * into _new;
  end if;
  perform public.business_audit('business_upsert_receiver','business_receivers',_new.id,_old,to_jsonb(_new),_actor_label);
  return _new.id;
end $$;

CREATE OR REPLACE FUNCTION public.business_set_receiver_active(_id uuid, _active boolean, _actor_label text DEFAULT NULL)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare _mid uuid := public.business_require_delivery(); _r public.business_receivers;
begin
  select * into _r from public.business_receivers where id=_id and merchant_id=_mid for update;
  if _r.id is null then raise exception 'Receiver not found'; end if;
  if _active and not _r.is_active and exists (select 1 from public.business_receivers where merchant_id=_mid and contact_phone=_r.contact_phone and is_active) then
    raise exception 'A receiver with this phone number already exists'; end if;
  update public.business_receivers set is_active=_active where id=_id;
  perform public.business_audit('business_set_receiver_active','business_receivers',_id,to_jsonb(_r),jsonb_build_object('is_active',_active),_actor_label);
end $$;

-- staff RPCs
CREATE OR REPLACE FUNCTION public.business_require_ops() RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ begin if not public.courier_is_ops_staff() then raise exception 'Only operations staff can do this' using errcode='42501'; end if; end $$;

CREATE OR REPLACE FUNCTION public.staff_create_business_account(_phone text, _business_name text, _city text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare _ph text; _mid uuid; _before jsonb;
begin
  perform public.business_require_ops();
  _ph := public.business_phone10(_phone);
  if coalesce(btrim(_business_name),'')='' then raise exception 'Business name is required'; end if;
  select id, to_jsonb(m) into _mid, _before from public.merchants m
   where right(regexp_replace(coalesce(phone,''),'\D','','g'),10)=_ph
   order by (auth_user_id is not null) desc, created_at limit 1 for update;
  if _mid is null then
    insert into public.merchants(phone, store_name, city, status, onboarding_step, store_enabled, delivery_enabled, delivery_status, onboarded_by)
    values (_ph, btrim(_business_name), coalesce(nullif(btrim(_city),''),'Latur'), 'draft', 1, false, true, 'active', auth.uid())
    returning id into _mid;
  else
    update public.merchants set delivery_enabled=true, delivery_status='active', updated_at=now() where id=_mid;
  end if;
  insert into public.business_profiles(merchant_id, business_name, city)
  values (_mid, btrim(_business_name), nullif(btrim(_city),''))
  on conflict (merchant_id) do update set business_name=excluded.business_name, city=coalesce(excluded.city, business_profiles.city);
  perform public.business_audit('staff_create_business_account','merchants',_mid,_before,
    (select to_jsonb(m) from public.merchants m where id=_mid), null);
  return _mid;
end $$;

CREATE OR REPLACE FUNCTION public.staff_set_merchant_modules(_merchant_id uuid, _store_enabled boolean, _delivery_enabled boolean, _reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$ declare _b jsonb;
begin
  perform public.business_require_ops();
  if coalesce(btrim(_reason),'')='' then raise exception 'Reason is required'; end if;
  if not coalesce(_store_enabled,false) and not coalesce(_delivery_enabled,false) then raise exception 'At least one module must stay on'; end if;
  select jsonb_build_object('store_enabled',store_enabled,'delivery_enabled',delivery_enabled) into _b from public.merchants where id=_merchant_id for update;
  if _b is null then raise exception 'Merchant not found'; end if;
  update public.merchants set store_enabled=_store_enabled, delivery_enabled=_delivery_enabled, updated_at=now() where id=_merchant_id;
  perform public.business_audit('staff_set_merchant_modules','merchants',_merchant_id,_b,
    jsonb_build_object('store_enabled',_store_enabled,'delivery_enabled',_delivery_enabled,'reason',_reason),null);
end $$;

CREATE OR REPLACE FUNCTION public.staff_set_delivery_status(_merchant_id uuid, _status text, _reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$ declare _old text;
begin
  perform public.business_require_ops();
  if coalesce(btrim(_reason),'')='' then raise exception 'Reason is required'; end if;
  if _status not in ('inactive','active','suspended') then raise exception 'Invalid status'; end if;
  select delivery_status into _old from public.merchants where id=_merchant_id for update;
  if not found then raise exception 'Merchant not found'; end if;
  update public.merchants set delivery_status=_status, updated_at=now() where id=_merchant_id;
  perform public.business_audit('staff_set_delivery_status','merchants',_merchant_id,jsonb_build_object('delivery_status',_old),
    jsonb_build_object('delivery_status',_status,'reason',_reason),null);
end $$;

CREATE OR REPLACE FUNCTION public.staff_upsert_business_profile(_merchant_id uuid, _business_name text, _gstin text, _city text,
  _vehicle_type_id uuid, _courier_type_id uuid, _batch_capacity int, _auto_time_enabled boolean, _time_slab_minutes int,
  _auto_qty_enabled boolean, _qty_threshold int, _low_balance_threshold numeric)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$ declare _b jsonb;
begin
  perform public.business_require_ops();
  if not exists (select 1 from public.merchants where id=_merchant_id) then raise exception 'Merchant not found'; end if;
  if coalesce(btrim(_business_name),'')='' then raise exception 'Business name is required'; end if;
  if coalesce(_batch_capacity,10) < 1 or coalesce(_time_slab_minutes,120) < 1 or coalesce(_qty_threshold,10) < 1 or coalesce(_low_balance_threshold,500) < 0 then
    raise exception 'Invalid settings'; end if;
  select to_jsonb(b) into _b from public.business_profiles b where merchant_id=_merchant_id;
  insert into public.business_profiles(merchant_id,business_name,gstin,city,vehicle_type_id,courier_type_id,batch_capacity,
    auto_time_enabled,time_slab_minutes,auto_qty_enabled,qty_threshold,low_balance_threshold)
  values (_merchant_id,btrim(_business_name),nullif(upper(btrim(_gstin)),''),nullif(btrim(_city),''),_vehicle_type_id,_courier_type_id,
    coalesce(_batch_capacity,10),coalesce(_auto_time_enabled,false),coalesce(_time_slab_minutes,120),coalesce(_auto_qty_enabled,false),
    coalesce(_qty_threshold,10),coalesce(_low_balance_threshold,500))
  on conflict (merchant_id) do update set business_name=excluded.business_name, gstin=excluded.gstin, city=excluded.city,
    vehicle_type_id=excluded.vehicle_type_id, courier_type_id=excluded.courier_type_id, batch_capacity=excluded.batch_capacity,
    auto_time_enabled=excluded.auto_time_enabled, time_slab_minutes=excluded.time_slab_minutes, auto_qty_enabled=excluded.auto_qty_enabled,
    qty_threshold=excluded.qty_threshold, low_balance_threshold=excluded.low_balance_threshold;
  perform public.business_audit('staff_upsert_business_profile','business_profiles',_merchant_id,_b,
    (select to_jsonb(b) from public.business_profiles b where merchant_id=_merchant_id),null);
end $$;

CREATE OR REPLACE FUNCTION public.staff_upsert_pickup_point(_merchant_id uuid, _id uuid, _name text, _address text, _lat numeric, _lng numeric,
  _contact_name text, _contact_phone text, _is_default boolean DEFAULT NULL, _is_active boolean DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$ begin
  perform public.business_require_ops();
  if not exists (select 1 from public.merchants where id=_merchant_id) then raise exception 'Merchant not found'; end if;
  return public.business_pickup_write(_merchant_id,_id,_name,_address,_lat,_lng,_contact_name,_contact_phone,_is_default,_is_active,'staff');
end $$;

-- execute grants
DO $$ declare f text; begin
  foreach f in array array[
    'merchant_caller_has_perm(text)','business_require_delivery()','business_require_ops()','business_check_location(numeric,numeric)',
    'business_audit(text,text,uuid,jsonb,jsonb,text)',
    'business_pickup_write(uuid,uuid,text,text,numeric,numeric,text,text,boolean,boolean,text)',
    'business_get_profile()','business_upsert_pickup_point(uuid,text,text,numeric,numeric,text,text,boolean,boolean,text)',
    'business_upsert_receiver(uuid,text,text,text,text,numeric,numeric,text,text)','business_set_receiver_active(uuid,boolean,text)',
    'staff_create_business_account(text,text,text)','staff_set_merchant_modules(uuid,boolean,boolean,text)',
    'staff_set_delivery_status(uuid,text,text)',
    'staff_upsert_business_profile(uuid,text,text,text,uuid,uuid,int,boolean,int,boolean,int,numeric)',
    'staff_upsert_pickup_point(uuid,uuid,text,text,numeric,numeric,text,text,boolean,boolean)']
  loop execute format('revoke all on function public.%s from public, anon', f); end loop;
  foreach f in array array[
    'business_get_profile()','business_upsert_pickup_point(uuid,text,text,numeric,numeric,text,text,boolean,boolean,text)',
    'business_upsert_receiver(uuid,text,text,text,text,numeric,numeric,text,text)','business_set_receiver_active(uuid,boolean,text)',
    'staff_create_business_account(text,text,text)','staff_set_merchant_modules(uuid,boolean,boolean,text)',
    'staff_set_delivery_status(uuid,text,text)',
    'staff_upsert_business_profile(uuid,text,text,text,uuid,uuid,int,boolean,int,boolean,int,numeric)',
    'staff_upsert_pickup_point(uuid,uuid,text,text,numeric,numeric,text,text,boolean,boolean)','business_require_delivery()']
  loop execute format('grant execute on function public.%s to authenticated', f); end loop;
end $$;
