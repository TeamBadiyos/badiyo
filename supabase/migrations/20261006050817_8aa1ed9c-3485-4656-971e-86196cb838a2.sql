do $$
begin
  perform set_config('app.booking_bypass','on', true);
  update public.bookings
     set razorpay_payment_id = 'pay_TkExebyJ4L77TT',
         start_otp = coalesce(start_otp, lpad((floor(random()*9000)+1000)::int::text,4,'0')),
         end_otp   = coalesce(end_otp,   lpad((floor(random()*9000)+1000)::int::text,4,'0'))
   where id = '795eeb46-bd79-46ea-8acc-6d5c332af899';
  update public.payment_intents set razorpay_payment_id = 'pay_TkExebyJ4L77TT'
   where id = '4cf198c9-212d-4a6f-9a9b-02a10e46ee94';
  perform set_config('app.booking_bypass','off', true);
  perform public.booking_dispatch_release_due();
end $$;