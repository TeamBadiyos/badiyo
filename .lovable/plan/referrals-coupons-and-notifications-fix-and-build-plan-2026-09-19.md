# Referrals, coupons and notifications — fix and build plan

Seven asks, grouped into four work blocks. Everything is tracked end to end so the Command Center can see what was earned and used.

## 1. Invite links open the app, not Chrome

Confirmed cause: the app-links verification file on the website lists the package `com.badiyo.customer`, but the live app is `com.badiyos.customer`. Android therefore never verifies the link and hands it to Chrome.

- Correct the package name in the verification file so `user.badiyos.com/invite/CODE` opens the installed app directly.
- If the app isn't installed, the invite page shows a "Open in app / Get the app" screen and sends the visitor to the Play Store listing, carrying the code so it is still applied after install and sign-up.
- The code keeps being saved locally on first touch, so it survives the Play Store detour and login.

Note: the signing fingerprint in that file must match the live Play Store signing key — I will flag it for you to confirm from Play Console.

## 2. Referral counting and progress

- Count a referral as *qualified* only when the friend's first booking is completed; show three clear numbers: invited, joined, qualified.
- Progress bar and milestone counter use qualified referrals only.
- Backfill/repair existing referral records so past invites show the right stage.

## 3. Referral offers and coupon rewards

- Referral milestone offers (e.g. "Refer 3 friends → 1 hour booking free") are configured in the Command Center: number of qualified referrals, reward type (free minutes, flat ₹ off, % off), validity.
- When the target is reached, the system automatically issues a coupon into the customer's Offers tab and sends a notification. Issuing is one-time per milestone per customer.

## 4. Coupons (Command Center → Offers tab → checkout)

- New coupon system: code, discount type (flat / percent / free minutes), max discount, minimum order, validity window, total and per-customer usage limits, active toggle, optional targeting (all customers / referral reward only).
- Offers tab in the app lists coupons the customer can use, with terms and expiry; marketing campaign banners also appear here.
- At checkout: apply/remove a coupon, discount shown in the price breakdown, and the payable amount recalculated **on the server** before the payment is created — the app can never set its own discount.
- Coins/wallet can be used together with a coupon (coupon first, then coins).
- Every use is recorded (customer, booking, coupon, amount saved) for full tracking, and released if the booking fails or is cancelled before payment.

## 5. Order notifications — every stage

Audit and complete the chain so each of these fires exactly once: booking placed → payment confirmed → accepted → expert assigned → expert on the way/arrived → started → 10-min-left → completed → cancelled/refunded. Tapping any of them opens the matching screen.

## 6. Reward, coupon and referral notifications

- Friend joined with your code; friend's first booking completed; reward credited; milestone reached; coupon issued; coupon expiring soon (2 days); coupon used.

## 7. Marketing campaigns with opt-out

- Campaigns composed in the Command Center (title, message, optional image, deep link, audience) are delivered as push **and** shown in the Offers tab.
- The existing Notifications settings screen gets a working "Promotions & offers" opt-out that marketing sends respect; order and reward alerts are always delivered.

## Technical notes

- `public/.well-known/assetlinks.json`: `package_name` → `com.badiyos.customer`; Play fallback from `src/routes/invite.$code.tsx` using a store URL for the same package, code retained via existing `src/lib/referrals.ts` storage.
- New tables: `coupons`, `coupon_redemptions`, `referral_milestone_programs` (or reuse `reward_programs` with a `coupon` reward type), `marketing_campaigns`, `campaign_deliveries` — each with GRANTs, RLS (customers read their own/active-public rows only), and staff-write policies via `is_active_staff`.
- Coupon validation/apply as SECURITY DEFINER RPCs (`coupon_preview`, `coupon_reserve`, `coupon_release`); `create-razorpay-order` recomputes the final amount from service price + GST − coupon − coins, ignoring any client-sent total.
- Referral qualification: keep `referral_transactions.status` as the single source (`registered` → `first_booking_completed` → `reward_credited`); dashboard counts `reward_credited` + `first_booking_completed` as qualified.
- Notifications reuse `notify_customer_alert` / `notify_push_event` with alert types per event; marketing sends filter on `users.notification_preferences->>'promos'`.
- Deep links per alert type map to the correct phase in `src/routes/index.tsx`.

## Suggested order

1. Invite link + referral tracking (quick, unblocks growth)
2. Coupons + Offers tab + checkout
3. Referral milestone coupons
4. Notification completeness + marketing campaigns
