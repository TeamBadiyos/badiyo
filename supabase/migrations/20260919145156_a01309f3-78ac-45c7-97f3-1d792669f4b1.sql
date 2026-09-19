do $$
begin
  if not exists (select 1 from vault.secrets where name = 'courier_job_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'courier_job_secret', 'Shared secret for courier refund worker');
  end if;
end $$;

create or replace function public.courier_dispatch_refund_job()
returns void language plpgsql security definer set search_path = public, vault, extensions as $$
declare _secret text;
begin
  if not exists (select 1 from public.courier_orders
                  where refund_status = 'refund_pending'
                    and refund_amount > 0
                    and (refund_next_attempt_at is null or refund_next_attempt_at <= now())) then
    return;
  end if;
  select decrypted_secret into _secret from vault.decrypted_secrets where name = 'courier_job_secret';
  if _secret is null then raise warning 'courier_job_secret missing'; return; end if;

  perform net.http_post(
    url := 'https://user.badiyos.com/api/public/courier/process-refunds',
    headers := jsonb_build_object('Content-Type','application/json','x-courier-job-secret', _secret),
    body := '{}'::jsonb
  );
exception when others then
  raise warning 'courier_dispatch_refund_job failed: %', sqlerrm;
end $$;

revoke execute on function public.courier_dispatch_refund_job() from public, anon, authenticated;
grant execute on function public.courier_dispatch_refund_job() to service_role;