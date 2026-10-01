UPDATE public.coupons
SET applicable_category_ids = ARRAY['508641a3-59fd-457c-be6a-74879be354cc'::uuid, '52685ec0-8466-4b6d-a85a-c1fa3ce1f8ea'::uuid],
    updated_at = now()
WHERE code = 'BADIYOS100';