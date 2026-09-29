-- Accept both "10 AM" and "10:00 AM" (and ranges) when reading a slot's start time.
create or replace function public.slot_start_ist(_date date, _slot text)
returns timestamptz language plpgsql stable set search_path = public as $$
declare m text[]; h int; mi int; ap text;
begin
  if _date is null or _slot is null then return null; end if;
  m := regexp_match(_slot, '(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])');
  if m is null then return null; end if;
  h := m[1]::int;
  mi := coalesce(nullif(m[2], '')::int, 0);
  ap := upper(m[3]);
  if ap = 'PM' and h < 12 then h := h + 12; end if;
  if ap = 'AM' and h = 12 then h := 0; end if;
  if h > 23 or mi > 59 then return null; end if;
  return ((_date::text || ' ' || lpad(h::text, 2, '0') || ':' || lpad(mi::text, 2, '0') || ':00+05:30')::timestamptz);
end $$;

grant execute on function public.slot_start_ist(date, text) to anon, authenticated, service_role;
grant execute on function public.service_slot_allowed(text, date, text, int) to anon, authenticated, service_role;