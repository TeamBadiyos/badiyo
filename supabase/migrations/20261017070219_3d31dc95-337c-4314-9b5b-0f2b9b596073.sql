DO $$ DECLARE _sql text; BEGIN
 _sql:=pg_get_functiondef('public.app_create_booking_wallet(jsonb)'::regprocedure);
 IF position('SELECT city_id INTO _city FROM public.addresses' in _sql)=0 THEN RAISE EXCEPTION 'Unexpected wallet function definition'; END IF;
 _sql:=replace(_sql,'SELECT city_id INTO _city FROM public.addresses WHERE id=_address AND user_id=_uid;', 'SELECT coalesce(public.app_city_for_location(latitude::double precision,longitude::double precision),public.city_id_by_name(city)) INTO _city FROM public.addresses WHERE id=_address AND user_id=_uid;');
 EXECUTE _sql;
END $$;