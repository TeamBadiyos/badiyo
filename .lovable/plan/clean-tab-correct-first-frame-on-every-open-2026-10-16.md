# Clean tab: correct first frame on every open

## Why it flashes today
- Status treats "hours not loaded yet" as open (`closed = state != null && !can_order`), so "Open now" shows first.
- Only service content is cached on the phone; hours and Book Now are not, so status, banner and slab wait for the network.
- Photos load from the internet each open and fade in from white; the in-memory "already loaded" list is empty after every restart.
- The splash can end before the Clean tab has what it needs.

## What changes

1. **Save everything the first frame needs, per service and city**
   - Save the last `app_service_hours` (clean + wash), `app_book_now_allowed` and `app_service_content` on the phone (same device cache as content).
   - On open these are used as the starting data; the server refresh runs in the background and the screen updates only if values differ.
   - Open/closed and "Opens 10 AM" are worked out on the phone from the saved weekly hours/holidays and the current India time, not from the saved "can_order" flag (which may be stale). Same for the banner slab and banner text. Saved Book Now only refines "busy vs free" while open.

2. **Never guess a state**
   - If hours are unknown (no cache, no reply yet): show the skeleton cards and the built-in sky, never "Open now".

3. **Photos stored on the phone**
   - On the app (Android): download each Command Center image once into the app's permanent storage (Capacitor Filesystem, already installed), keep a small list "web address → local file". Re-download only when the address changes; delete files no longer used.
   - Render from the local copy, shown immediately (no fade from white). On the web preview, fall back to the browser cache with images preloaded during the splash.
   - Fade-in is kept only for an image that truly isn't on the phone yet.

4. **Splash waits for the first frame**
   - Splash stays until saved data is read and the saved photos are ready (decoded), max ~1.5 s (down from 2 s). With a warm cache this is near-instant; with no network it never waits longer than 1.5 s.

5. **First install** — skeleton placeholders in final card/banner sizes until data arrives; default text only if the request fails.

## Test
- Playwright at phone size: load once, reload 5 times with network calls delayed 3 s — screenshot the first frame each time: correct status ("Opens 10 AM" at this hour), correct slab/banner text, no "Open now", no white boxes.
- Fresh storage + delayed network → skeleton only.
- The saved-photo part only runs inside the Android app, so that needs a phone check after Publish → Update (web-only change, no new Play Store build needed since Filesystem is already in the app).

## Technical details
- `src/lib/serviceSettings.ts`: `useServiceHours` / `useBookNowAllowed` get `initialData: readCache(...)`, `initialDataUpdatedAt: 0`, write cache on success, `structuralSharing` keeps identical data from re-rendering. Add `computeLocalState(hours, nowIST)` returning `{can_order, next_open_at}`; CleanTab uses it, with `undefined` → skeleton.
- New `src/lib/imageStore.ts`: `Capacitor.isNativePlatform()` gate, `Filesystem.downloadFile`/`writeFile` to `Directory.Data/img/<hash>`, manifest in localStorage, `Capacitor.convertFileSrc` for the src; sync map `localSrc(url)` available on first render; `img.decode()` in preload.
- `FadeImg`: start visible when local copy or decoded; no opacity transition then.
- `prefetchCleanTab(qc, 1500)` resolves when cache is read and cached images are decoded; network refresh continues after splash.
