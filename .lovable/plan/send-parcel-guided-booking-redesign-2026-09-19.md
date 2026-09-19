# Send Parcel — guided booking redesign

## Goal
Porter references ki clarity aur engagement lekar **badiyos ka original parcel flow** banana: current green branding aur existing Nunito Sans font ke saath. Sirf jo vehicle live hai wahi dikhega—abhi Bike.

## Customer journey

### 1. Route setup
- “Send a Parcel” header ke neeche compact step progress: **Locations → Bike → Parcel → Review**.
- Pickup aur drop ko green/red markers aur connecting route line ke saath ek clear route composer me dikhana.
- Saved addresses immediately selectable; default address pickup me preselect ho sakta hai.
- Har stop par **Change**, **Add new address**, aur **Select on map** options.
- Pickup aur drop ke liye name + compulsory 10-digit mobile; profile name/mobile se convenient prefill, lekin editable.
- Existing address map screen ko reuse karke map pin, address details, Home/Work/Other label aur save-address flow dena.

### 2. Bike selection
- Route summary top par compact rahe, edit action ke saath.
- Ek confident, illustrated **Bike** selection panel: max weight, supported parcel guidance, and server quote status.
- Fake trucks/scooters ya “coming soon” vehicles nahi dikhane; future active vehicles data se automatically list ho sakein.

### 3. Parcel details
- Existing parcel types ko clean icon rows/grid me show karna.
- Approximate weight aur rider note ko clear fields dena.
- Restricted-items warning ko prominent but calm band me dikhana; existing confirmation rule preserve karna.

### 4. Review and payment
- Pickup/drop route, contacts, selected Bike, parcel type and weight ka scannable review.
- Server-returned distance and fare breakup: delivery, handling, platform fee, discount, GST, total.
- Sticky bottom action: **Pay & Book Bike**; loading, unavailable pricing, validation and friendly payment errors properly handled.
- Back/edit actions entered data ko preserve karenge.

## Visual direction
- Selected **Guided booking flow** composition, adapted to a real full-screen Android experience rather than a desktop phone mockup.
- Existing **Nunito Sans** remains unchanged everywhere.
- Locked palette: badiyos green, deep teal, mint, white and dark ink; no Porter blue branding.
- Clean full-width stages, light mint surfaces, restrained shadows, 8px-or-less standard cards, generous touch targets and safe-area support.
- Small native-feeling step transitions, selection feedback and haptics; reduced-motion respected.
- References are inspiration only; their screenshots/assets will not be embedded.

## Reuse and implementation
- Refactor the current parcel booking screen into focused step components while preserving its existing server quote, Razorpay booking, validation and courier switch behavior.
- Reuse the existing saved-address data and map picker; extract only the minimum shared address-save behavior needed so parcel users can add an address without leaving the flow.
- Keep active vehicles and parcel types data-driven from existing configuration.
- Add only presentation tokens needed for the selected green/mint parcel styling; keep the rest of the app unchanged.
- Add English and Marathi copy for all new parcel labels and states.

## Validation
- Test the complete route on a mobile viewport: saved pickup, saved drop, add-via-map, contacts, Bike, parcel type, quote, review and payment handoff.
- Verify empty-address, missing coordinates, invalid phone, pricing unavailable, loading and back-navigation states.
- Confirm only Bike appears with current configuration, text does not clip, keyboard/sticky action do not overlap, and desktop preview remains constrained like the rest of the app.
- Run type checks and the production build.

## Out of scope
- No pricing, GST, coupon, payment, dispatch, OTP or database-rule changes.
- No multi-stop, cash payment, GSTIN, Porter rewards, or unavailable vehicle categories.
- Courier tracking screen remains unchanged in this redesign.
