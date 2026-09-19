create or replace function public.courier_verify_job_secret(_secret text)
returns boolean language plpgsql stable security definer set search_path = public, vault as $$
declare _stored text;
begin
  select decrypted_secret into _stored from vault.decrypted_secrets where name = 'courier_job_secret';
  if _stored is null or _secret is null then return false; end if;
  return _stored = _secret;
end $$;

revoke execute on function public.courier_verify_job_secret(text) from public, anon, authenticated;
grant execute on function public.courier_verify_job_secret(text) to service_role;