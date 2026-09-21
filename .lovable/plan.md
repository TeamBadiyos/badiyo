# Order flow fix: expert payout + instant status refresh

## Kya hua (last order me)

Order `84ab6190…` (NEW100 coupon, ₹149 discount) ka pura trail check kiya:

1. Payment hua, expert assign hua, service start hui — sab theek.
2. Order **Command Center se "completed" mark** hua (audit log: `update_booking_status`).
3. Expert ko ₹0 mila. Wallet ledger table **poori tarah khaali** hai — ek bhi payout entry nahi.

**Root cause:** expert ka payment sirf **End-OTP verify** karne wale raste par credit hota hai. Command Center ka "status change to completed" wala rasta sirf status badalta hai — na wallet credit, na reward trigger, na service end time. Coupon ya ₹0 bill se iska koi lena-dena nahi; expert ka ₹80 payout order ke waqt hi lock ho chuka tha (snapshot ₹80 expert / ₹10 partner / ₹59 HQ).

Isi tarah customer-side wala purana `advance_booking_status` bhi order ko complete kar sakta hai bina payout ke.

**Slow refresh ka karan:** orders list (`my-bookings`) par na live subscription hai, na auto-refresh; app ka default cache 5 minute ka hai. Isliye Command Center se complete karne par app me turant nahi dikhta — pull-to-refresh ya 5 min baad hi update hota hai.

## Fix plan

### 1. Payout ko ek hi jagah pakka karna (database)

- Ek naya central function `credit_booking_completion(booking_id)` banega jo: snapshot payout se expert wallet credit karega, wallet ledger entry banayega, reward triggers chalayega, expert ko `is_busy=false` karega — aur **idempotent** rahega (dobara complete karne par double credit nahi).
- Ek `AFTER UPDATE OF status` trigger lagega: **jis bhi raste se** booking `completed` hogi (expert OTP, staff OTP, Command Center status change, customer RPC), payout apne aap credit hoga.
- `service_end_at` aur `updated_at` bhi completion par set honge agar khaali hain.
- `staff_verify_end_otp` abhi payout `service_catalogue_config` se nikalta hai (snapshot se alag amount aa sakta hai) — use bhi same snapshot-based function par shift karenge, taaki teeno raste ek hi rakam de.

### 2. Purane order ka payout (backfill)

- Ek chhoti migration jo un **completed bookings** ko scan karegi jinka expert assign hai par wallet ledger me payout entry nahi — inka snapshot payout credit kar degi (last wala ₹80 bhi isi me aa jayega).

### 3. Instant refresh (app)

- Orders list par live subscription (booking insert/update) + short auto-refresh, taaki Command Center se status badalte hi 1–2 second me app me dikhe.
- `my-bookings` ka cache-time chhota (0) karenge aur screen par wapas aane / app foreground hone par refetch.
- Completed hote hi tracking screen se review/confirmation par jump wahi rahega (pehle se realtime par hai).

## Baki flow me mile issues (isi kaam me theek honge)

| # | Issue | Fix |
|---|---|---|
| 1 | Command Center completion par customer ko "completed" notification jaati hai, par expert ko payout wali alert nahi | central function se expert alert bhi jayegi |
| 2 | `bookings.updated_at` status change par update nahi hota | completion/status trigger me set hoga |
| 3 | Teen jagah alag payout calculation | ek hi snapshot-based function |
| 4 | ₹0 bill wale orders (100% coupon): expert ko poora ₹80 milega, HQ share minus me jayega | yahi sahi behaviour hai; koi change nahi, sirf confirm |

## Technical notes

- New DB function + `AFTER UPDATE OF status` trigger on `public.bookings`, SECURITY DEFINER, idempotency ledger `reason = 'Booking payout: <id>'` par based.
- `expert_verify_end_otp` / `staff_verify_end_otp` ka inline credit block hata kar central function call.
- Backfill migration: insert-select on `wallet_ledger` + `experts.wallet_balance` increment for missing rows.
- Frontend: `src/components/OrdersScreen.tsx` (+ `MyBookingsScreen.tsx`) me `refetchInterval`, `staleTime: 0`, aur `supabase.channel` postgres_changes on `bookings` filtered by `user_id`.
- Koi pricing / GST / payment change nahi (wo pichhle kaam me ho chuka).
