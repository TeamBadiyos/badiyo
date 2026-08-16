ALTER TABLE public.service_task_details ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.service_task_details TO anon, authenticated;
GRANT ALL ON public.service_task_details TO service_role;
DROP POLICY IF EXISTS "Anyone can view active service task details" ON public.service_task_details;
CREATE POLICY "Anyone can view active service task details"
ON public.service_task_details FOR SELECT
TO anon, authenticated
USING (is_active = true);