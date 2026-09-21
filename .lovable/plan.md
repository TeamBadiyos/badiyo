# Mobile safe-area and address overlay fix

## Goal
Android phones par camera cutout/status bar aur bottom gesture bar ke andar koi search bar, header, button, sheet, ya navigation na aaye. Address search ke results map pin, current-location button, aur address details ke saath overlap na hon.

## Changes

1. **App-wide top and bottom safe spacing**
   - Existing native status-bar measurement ko single app-level safe-area source ke roop me retain karna.
   - Shared safe-top/safe-bottom rules me Android fallback bhi include karna, taaki `env(safe-area-inset-*)` zero report kare tab bhi content camera/status bar se neeche rahe.
   - Main app shell ke saath full-screen, fixed, sticky, modal, sheet, toast, bottom navigation, tracking bar, support reply bar, courier screens, login/OTP/PIN screens aur loading/error screens audit karna.
   - Full-bleed map/background ko screen edge tak rehne dena, lekin interactive content ko safe bounds ke andar rakhna.
   - Bottom navigation aur fixed action areas me gesture/home-indicator clearance dena; scrollable pages me enough bottom content space rakhna taaki last item navigation ke peeche na chhupe.

2. **Address map screen spacing**
   - Search/back row ko measured top inset ke baad fixed visual margin dena.
   - Address form sheet aur Save Address button ko bottom safe inset ke upar rakhna.
   - Short-height phones par form ko scrollable banana, taaki top search aur bottom action ek doosre ko compress ya cover na karein.

3. **Search-results overlay hierarchy**
   - Search row/results ko map pin aur map controls se higher, isolated layer par rakhna.
   - Results khule hon tab center pin aur “Use current location” map control ko results ke upar dikhne se rokna.
   - Results panel ko opaque background, bounded height, internal scrolling, proper row separators, and stable title/area/distance columns dena.
   - Long business names, addresses, and distance labels ko truncate/wrap rules ke saath constrain karna, taaki icon, address aur distance overlap na karein.
   - Result choose/clear karne par overlay cleanly close karna aur map controls normal state me restore karna.

4. **Verification**
   - Android camera-cutout style narrow viewport aur normal mobile viewport par Home, Orders, Send Parcel, Rewards, address selection, map address form, courier pickup/drop, profile/support, login/OTP/PIN, and fixed bottom bars inspect karna.
   - Address search me long hospital/business names test karke confirm karna: search bar cutout se clear, list sabse upar, map pin list ke peeche, address text/icon/distance non-overlapping, aur Save button gesture area se clear.
   - Existing desktop/web layout aur Places search behavior unchanged rakhna.

## Technical details
- Primary files: `src/styles.css`, `src/routes/index.tsx`, `src/components/AddAddressMapScreen.tsx`, `src/components/PlaceSuggestionList.tsx`, `src/components/BottomNav.tsx`.
- Audit me jo fixed/sticky customer screens unsafe milenge, unke wrappers par wahi shared semantic safe-area utilities apply hongi; business logic, pricing, serviceability, maps search, and Expert app behavior change nahi hoga.
