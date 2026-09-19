# Payment error messages + Courier OTP backend & full Courier UI

Two parts: (A) never show raw payment error text again, (B) courier OTP controls plus the complete courier experience for customers and riders. Courier stays hidden until you turn it on in Latur.

## A. Payment failures in plain language

### Error reading
All Razorpay failures (native app sheet and website checkout) go through one reader that understands a plain text error, an error object, or an error nested inside another error, and pulls out code, description, source, step, reason and metadata. If nothing can be read, it becomes "unknown" — the raw text is never shown.

### Categories and what the customer sees
| Category | When | Message |
| --- | --- | --- |
| cancelled | user closed/back/"payment_cancelled" | Payment cancel ho gaya. Aap dobara try kar sakte hain. |
| declined | bank/card/UPI reject, insufficient funds | Bank ne payment reject kar diya. Dusra payment option try karein. |
| network | timeout / connectivity | Network dikkat aayi. Agar paise kate hain to 2 minute baad order status dekhein. |
| upi_unavailable | UPI app khula hi nahi / installed nahi | UPI app nahi khul paya. Dusra UPI option ya card try karein. |
| unknown | baaki sab | Payment nahi ho paya. Dobara try karein. |

All five in English and Marathi through the existing language system.

### Screens
- Cancelled: no failure screen at all — straight back to Booking Summary with a small "Payment cancelled" toast.
- Other categories: failure screen with a simple heading, the friendly line above, "Try Again" and "Back to Summary", a small reference id (last 6 characters of the order id) and a "Help & Support" link.
- No JSON, error code or technical wording anywhere.

### Logging
Full raw error goes to the console and is saved server-side against the order id (payment log) for debugging. Never shown to the customer.

### Safety (verify only, no logic change)
Coupon reservation release and wallet/coins return on cancel or failure, and webhook recovery still confirms a booking that succeeds after the failure screen — both checked, not modified.

### Where it applies
Booking payment, service extension top-up, and tip — identical behaviour in the app and on the website.

## B. Courier OTP backend

Three new database functions, all owner-only, locked search path, no access for logged-out callers:

1. **Resend** — stage-gated (pickup OTP only after the rider has arrived, delivery OTP only after the parcel is in transit), 60s cooldown and max 3 sends per OTP (both configurable). Sends through the existing WhatsApp campaign setup (separate courier campaign name) to the pickup or drop contact. If sending fails it returns an error but the code stays visible in the app. Every send attempt and its result is recorded in the order timeline.
2. **Refresh** — after expiry, issues a fresh code with a new issue time; the old one stops working.
3. **Change contact number** — owner only, only while that OTP is still unverified, max 2 edits, 10-digit Indian mobile check. Changing the number instantly re-issues that OTP and kills the old one. The rider sees the new number only on their assigned order. Every edit is written to both the audit log and the order timeline.

No automatic WhatsApp sending — messages go out only when the customer taps send/resend.

Access tests run as the customer, the rider and a different customer.

## C. Courier UI (customer + rider)

Hidden behind the service switch: the entry point appears only when courier is ON for that city and the vehicle is active, so nothing changes in the live app today.

**Customer**
- Courier tile on Home (hidden while off) → pickup and drop selection on the map with saved-address reuse and contact name/number for each end.
- Parcel step: parcel type, weight, description, prohibited-items confirmation.
- Fare screen: server-calculated fare with distance, coupon entry and GST, quote validity countdown; the app never computes or sends a total.
- Payment through the same in-app Razorpay sheet as bookings, with the new friendly error handling.
- Live tracking: status stages, rider card with call button, pickup and delivery OTP cards (stage-gated) with Resend, "get a new code" after expiry, and edit-contact-number, cancel button with the correct stage rules and fee warning, plus report-an-issue.
- Courier orders appear in My Bookings history with their receipt.

**Rider**
- Incoming courier offer with 30-second timer, accept/reject.
- Active job screen: pickup navigation, "I have arrived" (location-checked), OTP entry for pickup, start transit, OTP entry for delivery, delivered, plus report-incident. No cancel once the parcel is picked up.
- Earnings for completed courier jobs in the existing wallet view.

## Technical notes

- `razorpayCheckout.ts` gains `parseRazorpayError` + `mapRazorpayError` returning `{ category, rawMessage }`; `PaymentCancelledError` kept; consumers (`PaymentScreen.tsx`, `ServiceInProgressScreen.tsx` extension + tip) switch to category-driven copy from `src/i18n/en.ts` and `mr.ts`.
- Raw error persisted via a small server function writing into the existing payment/order log with the razorpay order id.
- New RPCs `courier_resend_otp`, `courier_refresh_otp`, `courier_update_contact`; new config keys `courier_otp_resend_cooldown_seconds` (60), `courier_otp_max_sends` (3), `courier_contact_edit_cap` (2); new columns on `courier_order_secrets` for send counts, and contact-edit counters on `courier_orders`; send performed by a server function reusing the AiSensy structure.
- Courier UI as lazy-loaded screens under `src/components/courier/` (customer) and the rider surface, driven by `courier_quote`/`courier_create_order` server functions and the existing rider/customer RPCs; realtime subscription on the order row for status updates.
- Verification: typecheck, production build, role-simulated access tests (customer / rider / other customer), and manual checks of the five payment error categories.
