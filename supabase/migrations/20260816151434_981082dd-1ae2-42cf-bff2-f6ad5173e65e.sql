ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS gallery_urls text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS video_url text,
  ADD COLUMN IF NOT EXISTS inclusions text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS exclusions text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.service_price_options
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS gallery_urls text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS video_url text,
  ADD COLUMN IF NOT EXISTS inclusions text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS exclusions text[] NOT NULL DEFAULT '{}';