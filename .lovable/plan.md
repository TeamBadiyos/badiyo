# Clean banner: read Command Center's new banner format

## What changes for you
- Banner picture and text colour come from Command Center's time slabs (crossing midnight works). Empty picture → built-in sky for that time.
- Banner title/sub-line come from the 4 state texts: Holiday → Closed → Open-busy / Open-free, in the app's language only.
- Campaign stays as is and overrides both when active.
- On "dark" slabs (bright skies) the address, its arrow and the area line turn charcoal; on "light" slabs they stay white with a soft shadow. Wallet/profile buttons unchanged.

## Technical details
- `src/lib/serviceSettings.ts`: remove `banners`, `BannerKey`, `morning_switch_time`, `time_slabs`, `TimeSlab`. Add `banner?: { slabs?: BannerSlab[]; texts?: Partial<Record<"open_free"|"open_busy"|"closed"|"holiday", ContentBanner>> }` with `BannerSlab = { from, to, label, image_url, text_color: "light"|"dark" }`.
- `CleanTab.tsx`:
  - `pickBanner` returns `campaign | holiday | closed | open_busy | open_free`; delete closed_morning/evening and switch-time logic.
  - `pickSlab(banner.slabs)` uses `text_color`; fallback skies/tones stay per time.
  - `useNextFreeSlot` triggered on `open_busy`; `dayLabel` fallback uses `closed` (tomorrow if after noon).
  - Report the slab tone up via a new `onHeroTone(tone)` prop.
- `HomeScreen.tsx`: keep `heroTone` state from CleanTab; on the Clean tab use charcoal (`text-foreground`, no shadow) for address, pin/arrow and area line when tone is "dark", else current white + shadow.
- Verify in preview at a day time and a night time.
