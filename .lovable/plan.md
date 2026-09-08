# Speed up the app: diagnosis and fixes

## What I measured

- **Service images are the biggest problem.** Each picture is fetched from `badiyos.com/api/public/service-image`. Measured now: first byte after **1.5–3.5 seconds** per image, and the browser is only allowed to keep it for **1 hour** before re-downloading. A home screen with 6 cards therefore feels frozen even when the text is already there.
- **Data calls are already parallel.** Home fires its five queries at once and warms them during the splash. Timing them directly: about **1.1s each** from here, running together — acceptable, not the main lag.
- **The home data call carries too much.** One request pulls every service *plus* long descriptions, galleries, videos, inclusions/exclusions and every task-type row — detail-page content the home screen never shows.
- **Some lists re-fetch on every visit.** Availability on Home and Search, and the Rewards screen, are marked "always stale", so every entry to those screens waits on the network again.
- **Home's saved-address lookup is two chained calls** (who am I → their address) that run again on every visit and are not cached.
- **Screens are lazy-loaded already** and only a few are pre-warmed; the rest show a full-screen spinner on first open.
- **Live subscriptions are clean.** All four tracking screens remove their channel on exit — no leak.

## Fixes to apply

### 1. Images (largest win)
- Serve pictures through this app instead of the slow external proxy: a cached image endpoint with a long, immutable cache so a picture is downloaded once and then comes from the device.
- Request pictures at the size actually displayed (card thumbnail vs. full gallery) and prefer modern compressed formats, so each file is a fraction of today's size.
- Show a soft placeholder tint while a picture loads, and pre-load the first gallery picture of the product being opened.

### 2. Lighter home data
- Split the one heavy request into a **light list** (name, price, image, availability) for Home/Search, and a **detail** request fired only when a product page opens.
- Pre-warm the detail request the moment a card is tapped, so the product page opens with content already there.

### 3. Fewer wasteful re-fetches
- Give availability and rewards a short cache (about 30–60 seconds) with background refresh, instead of blocking each visit on a fresh call.
- Cache the home address lookup like other data, keyed to the signed-in user, so revisits are instant.

### 4. Smoother navigation
- Pre-load the screen for the next likely step (product page, address, summary, orders, profile) while the user is reading the current one, so tapping never waits on a download.
- Replace the blank full-screen spinner with a skeleton of the screen being opened, so it feels instant.
- Stop the visible list cards from re-rendering when unrelated state changes.

## Technical notes

- New route `src/routes/api/public/service-image.ts` (or equivalent) streaming from the private `service-images` bucket with `Cache-Control: public, max-age=31536000, immutable`; `src/lib/serviceImage.ts` points at it and accepts a width hint.
- Split `fetchSegmentServices` in `src/lib/segments.ts` into `fetchSegmentServicesLite` (home/search) and `fetchServiceDetail(itemId)`; keep the flattened `SegmentService` shape for detail.
- Replace `staleTime: 0` in `HomeScreen.tsx`, `SearchResultsScreen.tsx`, `RewardsScreen.tsx` with `staleTime: 30_000` + `refetchOnMount: "always"` background behaviour.
- Move the `addresses` effect in `HomeScreen.tsx` into a `useQuery(["home_address", uid])`.
- Extend the existing `lazyNamed` warming in `src/routes/index.tsx` with a `warm(phase)` helper called on the transitions above; memoise `ServiceProductCard`.
- Tracking screens' realtime cleanup stays as is.

## Verification

Re-measure image first-byte and repeat-visit load, home data payload size, and time from tapping a card to the product page rendering; report before/after numbers.
