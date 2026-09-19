# App speed fix — faster splash, login and screen loads

## What I measured (live site, just now)

- The server is not the problem: the site answers in ~0.4s, and the database queries average 1-2 ms.
- On a simulated slow phone network, the login screen appeared only after **6.1s**, and on a real phone with weaker signal this stretches much further.
- Reasons found:
  1. The splash screen has **fixed waits of 1.8s and 2.3s** built in, and it also waits for a login-session check before those timers even start.
  2. The app **starts loading its content only ~3.5s after opening** — all data requests fire after the whole app code has downloaded and started.
  3. The main app code file is **612 KB** and took 2.1s alone on a slow connection; it is downloaded before anything can appear.
  4. The app opens **61 separate downloads** at startup; each one costs a round trip on mobile data.
  5. Nothing is remembered between app opens — home content, categories and the profile photo are fetched from scratch every single launch.
  6. The logo image is a 67 KB PNG, and the font file is fetched from Google on the critical path.

## What I will change

**1. Splash becomes instant**
Remove the hard-coded 1.8s/2.3s waits. Splash shows only while the session check is running, with a short safety cap; login appears as soon as the app is ready. The session check gets a timeout so a slow network can never freeze the splash.

**2. Content starts loading immediately**
Add early-connection hints to the database host and kick off home/config requests at page start instead of after the app code finishes loading. This alone removes about 3 seconds from a cold open.

**3. Remember data between opens**
Persist the cached data (segments, categories, services, home sections, profile photo link) on the device, so Home, Profile and Offers paint instantly from the last known content and refresh quietly in the background. Prices and availability still re-validate before booking, so nothing stale is ever charged.

**4. Smaller, fewer downloads**
Split heavy libraries (charts, maps, date utilities) out of the startup file so they load only on the screens that need them, and group the many tiny per-screen files into a few bundles to cut round trips. Keep the existing background pre-loading of likely next screens.

**5. Images and font**
Convert the logo to a compressed modern format, keep the font from blocking first paint, and give the profile photo an instant initials placeholder while its link loads.

**6. Loading feel**
Replace blank waits during screen switches with lightweight skeletons so navigation feels immediate even when data is still arriving.

## Not changing

Design, prices, GST, booking/dispatch logic, payment flow, rewards rules. No new app build is required — the Play Store app loads the live site, so these improvements reach existing installs.

## Verification

Re-run the same slow-network measurement before/after and report: time to login screen, time to Home, number of startup downloads, and startup file size. Type check and production build must pass.
