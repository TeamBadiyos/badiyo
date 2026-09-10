# Custom GST percentage (default 5%)

Add a single, admin-controlled GST percentage that is applied on top of every item price at checkout, shown clearly to the customer, and snapshotted onto each booking so past orders never change.

## What the customer sees

- Booking Summary and Payment now show a price breakdown:
  - Item price (e.g. Rs 100)
  - GST @ 5% (e.g. Rs 5)
  - Total payable (Rs 105)
- The amount charged by Razorpay equals the total including GST.
- Service cards and the product page keep showing the base item price (GST appears at checkout).

## Where the percentage is set

- Stored as one setting row in the shared ops settings table, key `gst_percent`, seeded with `5`.
- Editable from the admin/ops panel (the same place other ops settings live) by super admin / ops manager only.
- If the value is missing or invalid, the app falls back to 5%.

## Existing bookings

Each booking stores the GST rate, GST amount and total that applied at the time of purchase. Changing the percentage later affects only new bookings; history and past invoices stay exactly as paid.

## Technical details

Database (migration):
- Insert `ops_settings` row: key `gst_percent`, label "GST percentage applied on top of service prices", value `5`. Add an ops/super-admin update policy for `ops_settings` if none exists.
- Add a read path for the app: a `SECURITY DEFINER` function `get_gst_percent()` returning numeric (default 5), granted to `anon` and `authenticated`, so the customer app can read the rate without exposing the whole settings table.
- Add columns to `bookings`: `gst_percent numeric not null default 0`, `gst_amount numeric not null default 0`, `total_amount numeric not null default 0`.
- Update `bookings_before_insert()`: after resolving `_price`, read `get_gst_percent()`, set `NEW.gst_percent`, `NEW.gst_amount = round(_price * pct / 100, 2)`, `NEW.total_amount = _price + gst_amount`. Base `price` stays the item price, so nothing else that reads `price` breaks.
- `system_fulfill_payment_intent`: keep inserting `price` from catalogue (the trigger already overwrites it); no amount validation change needed since GST is derived server-side.

Server (`supabase/functions/create-razorpay-order/index.ts`):
- After resolving the authoritative `price`, read `gst_percent` from `ops_settings` with the service-role client, compute `amount = round(price * (1 + pct/100) * 100)` paise, and include `gst_percent` and `base_price` in the order notes and in the payment-intent payload.
- Extension payments (`purpose: "extension"`) get the same GST treatment.

Frontend:
- New helper `src/lib/gst.ts` + React Query hook (`staleTime` 5 min) that calls `get_gst_percent()`.
- `BookingSummaryScreen.tsx`: price-details block becomes Item price / GST (x%) / Total.
- `PaymentScreen.tsx`: displayed amount uses booking `total_amount` when present, else base price + live GST.
- `BookingDetailsScreen.tsx` / `MyBookingsScreen.tsx`: show the stored `total_amount` for the paid amount, with the stored GST line in details.
- Add i18n strings for "GST", "Item price", "Total payable" in `en.ts` and `mr.ts`.
