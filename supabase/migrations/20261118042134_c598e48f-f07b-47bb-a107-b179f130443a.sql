select public.system_set_booking_refund_state(x.id::uuid,'processing',x.amt,x.rid,1,null,null) from (values
('59b1b3c9-694b-4541-9e6d-fbbc879ac2af',156.00,'rfnd_U1VJOrSzwO7VGN'),
('62320167-0cbe-4314-adc4-e6ae4bf8b470',303.00,'rfnd_U1VJR2mZaLDMeE'),
('425a2ccc-a4c2-4787-b629-f6176052cb5f',156.00,'rfnd_U1VJTBAwzVhYch'),
('e0861b25-ca12-4b79-93b0-ef144f3df2d5',156.00,'rfnd_U1VJV8Mlgdqg2G'),
('d4dc13d4-9ae3-41f5-ae4f-a505f399b8de',156.00,'rfnd_U1VJXOreSDk36V'),
('4fcec519-021f-4ef5-80a2-cd2a88b1f394',151.50,'rfnd_U1VJZghlUIONUA'),
('50eee287-5b46-43ad-9f77-591d4a42eafa',156.00,'rfnd_U1VJbriPHPeyzT')) as x(id,amt,rid);

do $$ begin
  if not exists (select 1 from vault.secrets where name='courier_job_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'courier_job_secret','Shared secret for refund worker jobs');
  end if;
end $$;

select cron.schedule('booking-refund-sweeper','0 * * * *','select public.booking_dispatch_refund_job();');