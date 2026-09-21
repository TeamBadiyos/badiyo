# Refund flow fix (home service bookings)

## Kya galat hai (verified)

Aaj ke dono cancelled orders me refund fail hua:

| Order | Paid | Refund amount | Refund status | Razorpay refund id |
|---|---|---|---|---|
| 8e558600 (pay_TeZwGiS90weqn4) | Rs 7.45 | 0 | failed | none |
| a07f8835 (free order) | Rs 0 | 0 | failed | none |

Logs me free order par: `[customer-cancel-booking] invalid payment id`.

Teen alag problems:

1. **Razorpay par refund kabhi bana hi nahi.** Cancel karne wala `customer-cancel-booking` server code Razorpay ko refund request bhejne me fail ho raha hai aur booking par sirf "failed" likh deta hai — na dobara koshish hoti hai, na kisi ko alert jaata hai. Paisa customer ke paas wapas nahi gaya.
2. **App jhooth bol raha hai.** Cancel ke baad app hamesha "Refund of Rs X is on its way" dikhata hai — chahe server ne 0 refund kiya ho ya fail hua ho. Isi wajah se app me "refunded" dikha aur Razorpay me kuch nahi.
3. **Rs 0 (full-discount) order par gateway refund try hota hai** aur "invalid payment id" se fail ho jaata hai; usse "failed" mark hona hi galat hai — wahan refund lagta hi nahi.

Ek aur cheez: app me cancellation fee Rs 100 hardcoded hai, jo Rs 7.45 wale order par bemaani hai — refund 0 dikh raha hai.

## Kya banega

**A. Refund ko project ke andar laayenge**
Cancel + refund ka poora logic project ke andar ek server function me likha jayega (abhi purana code project me hai hi nahi, isliye na review ho sakta hai na fix). Usme:
- Refund amount hamesha server par: actually paid amount (total_amount) minus applicable cancellation fee, kabhi paid se zyada nahi.
- Cancellation fee ab settings se aayegi, app me hardcoded 100 nahi.
- Razorpay refund API call idempotency key ke saath, taaki double refund na ho.
- Success par `refund_id` + `refund_status = 'processing'` save.
- Rs 0 / free order par gateway skip aur `refund_status = 'not_applicable'` (failed nahi).

**B. Fail hone par chup nahi rahenge**
Refund fail ho to booking `refund_status = 'pending'` me jaayegi, attempt count + next attempt time ke saath. Ek retry worker (courier wale process-refunds jaisa) har baar pending refunds dobara try karega, aur baar-baar fail hone par admin alert jayega.

**C. Razorpay webhook se status pakka karenge**
Webhook me `refund.processed` / `refund.failed` events handle honge, jisse booking par final status (`refunded` / `failed`) Razorpay ki asli state se match kare.

**D. App me sach dikhega**
- Cancel ke baad toast server ke jawab se banega: refund ho raha hai / refund lagta nahi / refund me dikkat, support se sampark.
- Order detail me refund line: amount, status (Processing / Refunded / Not applicable / Issue) aur 5-7 working days ka note.
- Dialog me estimated refund bhi server-configured fee se dikhega.

**E. Purane do orders theek karna**
- 8e558600: Rs 7.45 ka actual refund Razorpay par process karke booking par refund id/status set.
- a07f8835: free order, status `not_applicable` (koi paisa nahi liya gaya tha).

## Technical notes

- Naya `src/lib/bookingCancel.functions.ts` (createServerFn, auth middleware): fee/refund calculation, Razorpay `POST /v1/payments/:id/refunds` (`speed: normal`, notes with booking id, `Idempotency-Key: refund_<booking_id>`), phir existing `customer_cancel_booking_apply` RPC ko real values ke saath call.
- Migration: bookings me `refund_attempts int default 0`, `refund_next_attempt_at timestamptz`, `refund_error text`; `refund_status` allowed values `none | not_applicable | processing | refunded | pending | failed`.
- Naya `src/routes/api/public/bookings/process-refunds.ts` (job-secret verified) + pg_cron/dispatch trigger, courier ke `process-refunds` pattern par.
- `src/routes/api/public/webhooks/razorpay.ts`: `refund.processed`, `refund.failed` handle (signature verify already maujood).
- `CancelBookingButton.tsx`: hardcoded `CANCELLATION_FEE = 100` hatao, server response se messaging; `BookingDetailsScreen.tsx` / `OrdersScreen.tsx` me refund status row; en/mr i18n keys.
- Deployed `customer-cancel-booking` edge function ko purane clients ke liye chhoda jayega par app usse call nahi karegi.
- Koi pricing, GST, dispatch ya payout logic nahi badlega.
