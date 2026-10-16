# Roadmap

## Checkout coupons — DONE

- [x] Replace inline code box with coupon summary row
- [x] Add booking-aware coupon picker with manual code and eligible/unavailable offers
- [x] Verify type safety and public preview stability; authenticated booking preview unavailable for external Supabase

## Courier (Porter-type) — DONE

- [x] M1 config: service_flags, courier_vehicle_types, courier_vehicle_rates (placeholder), courier_types + mapping, hidden courier segment/skill category, ops_settings keys, Vault OTP key
- [x] M2 core: courier_orders, courier_order_secrets (no client access), courier_order_events, courier_offers, transition guard + event triggers, RLS
- [x] M3 logic: quote/create (server-only), dispatch + race-safe accept, OTP issue/verify/get, cancel + refund matrix, settlement, sweeper, staff RPCs
- [x] M4 existing bookings: service_flag check (fail-open when no flag row)
- [x] Server layer: src/lib/courier.functions.ts (Routes distance, Razorpay `courier` purpose, WhatsApp OTP hook), /api/public/courier/process-refunds, webhook `courier` handling + late-payment auto-refund
- [x] Cron: `courier-sweeper` every 30s (isolated from dispatch-radius-expand); refunds fire on-event via trigger + sweeper retry
- [x] Customer courier UI: guided locations, bike, parcel details, review/payment and tracking

### Rollback SQL (courier foundation)

```sql
select cron.unschedule('courier-sweeper');
drop trigger if exists trg_bookings_check_service_flag on public.bookings;
drop function if exists public.bookings_check_service_flag();
drop table if exists public.courier_offers, public.courier_order_events,
  public.courier_order_secrets, public.courier_quote_log, public.courier_orders cascade;
drop table if exists public.courier_vehicle_courier_types, public.courier_vehicle_rates,
  public.courier_types, public.courier_vehicle_types, public.service_flags cascade;
-- courier_* and staff_courier_* functions drop with cascade above or individually
```

## Pending user actions

- Razorpay Dashboard: webhook https://user.badiyos.com/api/public/webhooks/razorpay with payment.captured + order.paid
- Supabase: enable leaked-password protection
- Courier WhatsApp OTP: AISENSY_COURIER_OTP_CAMPAIGN (falls back to login campaign; OTP also visible in app)
- Set real courier rates in Command Center and flip `is_placeholder` off before going live
- Review notification-sounds public download finding

## Live tracking maps — DONE

- [x] Replace parcel straight line with a throttled Google road route to the current stage destination
- [x] Add road route from the assigned expert to the home-service address
- [x] Replace generic live dots with dedicated 3D courier/Auto Care and woman Home Care markers

## Multi-stop courier Marathi — DONE

- [x] Translate the stops timeline, OTP sharing, contact editing, return charges, final states, and order chips
- [x] Translate the “Parcels for you” list and detail screens
- [x] Send the stop-contact push in the recipient's saved English or Marathi language without including the OTP

## Customer redesign — Part 1
- [x] Theme: white bg, charcoal text, 20px cards, soft shadows, Nunito Sans
- [x] 5 tabs Clean · Store · Food · Parcel · Rewards, last-used tab remembered; Orders → Profile
- [x] Header: address label + area, wallet pill, avatar
- [x] "Bring badiyos" outside-city screen with service picker → Demand (waitlist_requests)
- [x] Removed All/Clean/Store chips and Sell-on-badiyos banner (→ Profile › Partner with badiyos)
- [x] One cart at a time with "clear and start new" (store cart already enforced)
- [x] Browse without login (login only for Book/Wallet/Rewards/Orders/Parcel)
- [ ] First-open Location + Notifications screen; follow phone language on first open
- [ ] Structured address form (City dropdown, pincode validation, Confirm this location)
- [ ] Single checkout page for all services
- [ ] Active order strip swipeable for several orders
- [ ] "{N} people waiting" count — needs a server count function (DB changes not possible from this session)
- [ ] CC "Hide sections with too few items" setting — needs a DB setting row + Command Center switch
