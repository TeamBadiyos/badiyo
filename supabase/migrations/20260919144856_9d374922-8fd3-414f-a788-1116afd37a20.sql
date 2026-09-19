create or replace function public.bookings_check_service_flag()
returns trigger language plpgsql security definer set search_path = public as $$
declare _city text; _active boolean;
begin
  select coalesce(z.city, a.city) into _city
    from public.addresses a
    left join public.zones z on z.id = NEW.zone_id
   where a.id = NEW.address_id;

  if _city is null then
    select city into _city from public.zones where id = NEW.zone_id;
  end if;
  if _city is null then return NEW; end if;

  select is_active into _active from public.service_flags
   where service_key = 'clean' and lower(city) = lower(_city);

  if _active is not null and _active = false then
    raise exception 'This service is currently unavailable in %', _city
      using errcode = 'check_violation';
  end if;
  return NEW;
end $$;

revoke execute on function public.bookings_check_service_flag() from public, anon, authenticated;

create trigger trg_bookings_check_service_flag
  before insert on public.bookings
  for each row execute function public.bookings_check_service_flag();