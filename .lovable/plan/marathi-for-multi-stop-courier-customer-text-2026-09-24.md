# Marathi for multi-stop courier customer text

## Scope
Add short, everyday Marathi translations for the customer-facing multi-stop courier text only. English remains unchanged and Marathi follows the existing `useT()` dictionary pattern used by the booking screen.

## Changes

1. **Translation dictionaries**
   - Add matching English and Marathi keys for:
     - stop types, stop numbering, stop states, current-stop state, and OTP timing help
     - OTP labels, safety help, Share, and the full OTP share message
     - edit-contact title, fields, save state, success, and error text
     - return-charge pending/paid/payment states, errors, amount text, and drop label
     - delivered/returned parcel summaries and final cancelled/delivered states
     - multi-stop chips in Orders: pickup/drop counts and pending return payment
     - “Parcels for you” card, list, statuses, details, rider labels, unavailable/empty states, and next-stop message
   - Keep digits as Latin numerals, matching the current language system.

2. **Customer courier screens**
   - Replace only the listed hard-coded multi-stop English text in `StopsTimeline`, `CourierTrackingScreen`, `OrdersScreen`, and `ContactParcels` with translation lookups.
   - Pass the active translator into helper functions that generate labels, parcel summaries, and OTP share text so shared/WhatsApp text is also Marathi when Marathi is selected.
   - Preserve all layouts, styling, polling, payment, OTP, contact-edit, tracking, and order-state behavior.

3. **Parcel contact push**
   - Add a database migration that updates only the existing stop-contact notification function.
   - Read the recipient’s `users.preferred_language`; send Marathi title/body for Marathi users and retain the existing English title/body for everyone else.
   - Keep recipient matching, notification route, OTP privacy, and delivery behavior unchanged.

## Verification
- Run the existing code check.
- Verify representative Marathi rendering for the stops timeline, edit contact, return charge, final state, Orders chips, and “Parcels for you” screens.
- Confirm English still falls back correctly and the migration changes only notification wording selection.
