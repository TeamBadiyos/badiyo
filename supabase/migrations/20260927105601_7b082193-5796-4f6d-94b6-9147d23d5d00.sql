do $$
declare _def text; _new text;
begin
  select pg_get_functiondef(p.oid) into _def from pg_proc p where p.proname='business_get_trip_otps' and p.pronamespace='public'::regnamespace;
  _new := replace(_def, '_r record;', '_rider_name text; _rider_phone text;');
  _new := replace(_new, 'select name, phone into _r from', 'select name, phone into _rider_name, _rider_phone from');
  _new := replace(_new, '''rider_name'',_r.name,''rider_phone'',_r.phone', '''rider_name'',_rider_name,''rider_phone'',_rider_phone');
  if _new ~ '_r\.' or _new !~ '_rider_phone from' then raise exception 'trip_otps patch incomplete'; end if;
  execute _new;

  select pg_get_functiondef(p.oid) into _def from pg_proc p where p.proname='courier_get_contact_view' and p.pronamespace='public'::regnamespace;
  _new := regexp_replace(_def, '(\m_e\s+record\s*;)', '_rider_name text; _rider_photo text;');
  _new := replace(_new, 'select name, photo_url into _e from', 'select name, photo_url into _rider_name, _rider_photo from');
  _new := replace(_new, '''name'',_e.name,''photo_url'',_e.photo_url', '''name'',_rider_name,''photo_url'',_rider_photo');
  if _new ~ '\m_e\.' or _new ~ '\m_e\s+record' or _new !~ '_rider_photo from' then raise exception 'contact_view patch incomplete'; end if;
  execute _new;
end $$;