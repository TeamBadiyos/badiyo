# Home look — one pass

## 1. Bottom tabs: floating dark pill
- One fully rounded bar, about 64px tall, charcoal #222831. It sits 16px from each side and 12px above the phone's bottom safe area, with a soft shadow.
- Line icons only: Clean = sparkles, Store = shopping basket, Food = utensils, Parcel = package, Rewards = gift. The 3D pictures and green glow are removed (the five nav images are deleted).
- Selected tab: a white pill with a green #00B97A icon and a bold label (English / मराठी). The pill slides smoothly from tab to tab.
- Other tabs: icon only, light grey #C9CED6.
- The bar stays hidden on full-screen booking, checkout and tracking pages, as it is today. Only Home, Orders and Rewards show it.

## 2. Bottom spacing
- Add one shared bottom-space value = bar height + 12px gap + safe area + 24px.
- Use it on every screen that shows the bar (Home with all five tabs, Orders, Rewards). Refer & Earn, card titles and the floating cart bar then always clear the bar.
- Full-screen pages with their own Pay button (checkouts) keep their own bottom bar and padding, because the tab bar is hidden there.

## 3. Clean tab
- Maid / Car Wash service card titles go one size smaller (~18px).
- Banner slab timing fix:
  - Today the slab is picked only when the screen draws. If the app was opened or left open earlier, it keeps the old slab image. At 05:58 that showed the day image instead of the 05:00–10:00 slab. This is the likely cause; it will be confirmed on the preview by setting the clock to 05:58.
  - The banner will re-check the India time every minute and whenever the app comes back to the foreground. It switches as soon as the slab changes.
  - All slab images will be saved to the phone ahead of time, so the new slab's photo appears right away with no flash. Saved photos from slabs that were removed will be cleared.

## Technical details
- `src/components/BottomNav.tsx`: rewrite using lucide icons, positioned with `fixed` plus `bottom: calc(env(safe-area-inset-bottom) + 12px)`, `inset-x-4`, `h-16`, `rounded-full`. The sliding white pill is an absolutely positioned element moved by `transform`, with a width/offset transition. Add `--nav-charcoal`, `--nav-inactive` and `--nav-bar-space` tokens to `src/styles.css`, and remove the old nav-glow utilities. Delete `public/brand/nav/*.webp`.
- Replace `pb-28` etc. in HomeScreen / OrdersScreen / RewardsScreen with a `pb-nav` utility. Raise CartBar's bottom offset above the bar.
- `CleanTab.tsx`: add a `useIstMinute()` hook (minute interval + `visibilitychange`/Capacitor `appStateChange`). It feeds `pickSlab(slabs, now)`, so the slab is recomputed as time passes. Call `syncImages` on all slab `image_url`s whenever content loads. Card title class goes from `text-xl` to `text-lg`.
