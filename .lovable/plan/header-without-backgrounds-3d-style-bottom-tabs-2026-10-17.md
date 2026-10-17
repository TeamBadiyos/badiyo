# Header without backgrounds + 3D-style bottom tabs

## 1. Home header (Clean tab) — no white card behind location and wallet
- Remove the white card behind "Home ▾ / area", the wallet pill and the profile circle.
- Text colour follows the sky picture automatically:
  - Light-text sky (evening/night, or CC slab `text_color: light`) → light badiyos green text and icons.
  - Dark-text sky (morning/day, or `text_color: dark`) → dark badiyos green text and icons.
- Store / Food / Parcel tabs keep their current look (plain white header).

## 2. Bottom tabs — like the reference picture
- Floating rounded white bar with soft green glow, lifted from the bottom edge.
- Each tab gets a colourful 3D-style picture icon on a soft pastel circle:
  - Clean: broom with sparkles (mint circle)
  - Store: grocery basket (cream circle)
  - Food: burger + drink (peach circle)
  - Parcel: flying parcel box (light blue circle)
  - Rewards: gold trophy (lilac circle)
- Selected tab: rises into a bump in the bar, sits on a large badiyos-green circle with glow, label in bold green. Others: label in dark grey.
- Same 5 tabs as now (no new Home tab); tap shrink animation kept.

## Technical details
- Add two tokens in `src/styles.css`: `--header-on-light` (dark green) and `--header-on-dark` (light green), plus 5 pastel tile tokens.
- `HomeScreen.tsx`: keep `heroTone` state via existing `CleanTab` `onHeroTone` prop; header button/wallet/profile classes switch on it; drop `bg-card/90`, `shadow-soft`, `backdrop-blur` on Clean.
- Generate 5 transparent PNG icons (imagegen, 512px) into `src/assets/nav/`, downscale to ~128px webp-equivalent, and copy into `public/brand/nav/` too so native/offline works (same pattern as BadiyoLogo).
- Rewrite `BottomNav.tsx` with image icons, bump shape (SVG/radial cutout) behind the active circle, `shadow-nav` glow in primary.
- Typecheck and preview screenshot at phone size.
