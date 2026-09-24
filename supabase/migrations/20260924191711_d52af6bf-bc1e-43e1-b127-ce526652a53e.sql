create or replace function public.courier_my_phone10() returns text language plpgsql stable security definer set search_path=public as $$
declare _del timestamptz; _email text; _econf timestamptz; _phone text; _pconf timestamptz; _m text[];
begin
  if auth.uid() is null then return null; end if;
  select deleted_at into _del from public.users where id=auth.uid();
  if _del is not null then return null; end if;
  select email, email_confirmed_at, phone, phone_confirmed_at into _email, _econf, _phone, _pconf from auth.users where id=auth.uid();
  if _econf is not null then
    _m := regexp_match(lower(coalesce(_email,'')), '^phone_91([6-9][0-9]{9})@badiyos\.phone\.local$');
    if _m is not null then return _m[1]; end if;
  end if;
  if _pconf is not null then
    _phone := regexp_replace(coalesce(_phone,''),'\D','','g');
    if length(_phone)>=10 then return right(_phone,10); end if;
  end if;
  return null;
end $$;
revoke all on function public.courier_my_phone10() from public, anon, authenticated;
grant execute on function public.courier_my_phone10() to service_role;