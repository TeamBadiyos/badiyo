# App Links fingerprint update + publish

## Kya karna hai

1. **assetlinks.json — naya SHA-256 fingerprint**
   - `public/.well-known/assetlinks.json` me `sha256_cert_fingerprints` me purana `BB:68:6C:…:5D:C3` hata kar naya daalna hai:
     `A8:82:51:BE:D1:8B:58:74:FB:E0:32:B7:A9:1B:DC:F5:65:7C:D1:4F:29:9A:01:69:4F:5B:A8:3C:02:1A:B4:A6`
   - Package `com.badiyos.customer` waisa hi rahega.
   - Isse Android `user.badiyos.com` ke links verify karega aur referral/invite link seedha app me khulega (Chrome nahi).

2. **Cold-start invite code check**
   - Confirm/fix karna hai ki startup par `App.getLaunchUrl()` call ho — app pehli baar link se khule (cold start) to bhi `/invite/CODE` capture ho.
   - Existing `appUrlOpen` listener ke saath mila kar dono cases cover honge: app already khula ho (warm) ya link se hi khule (cold).

3. **MANUAL_MERGE.md updates**
   - `@capgo/capacitor-install-referrer` ka version Capacitor 8 ke hisaab se note karna (v8.x line, e.g. `@capgo/capacitor-install-referrer@^8`).
   - Razorpay Android SDK ke liye ProGuard/R8 rules ka note add karna — release build minify hoti hai to Razorpay classes strip na hon:
     `-keepclassmembers class * { @android.webkit.JavascriptInterface <methods>; }` aur `com.razorpay.**` keep rules.

4. **Publish** — sab changes ke baad site publish karna.

## Technical details

- File: `public/.well-known/assetlinks.json` — sirf fingerprint value badlegi, JSON structure same.
- `src/routes/index.tsx` — `App.getLaunchUrl()` handling verify/karni hai (invite code `decodeURIComponent` + uppercase ke saath store hota hai, `linkReferralIfAny()` signed-in user ke liye).
- `native/android/MANUAL_MERGE.md` — plugin version note + ProGuard block add.
- Verify: JSON valid ho, fingerprint format sahi ho (64 hex chars, 32 colon-separated pairs), typecheck pass, fir publish.

## Aapko kuch nahi karna

Sirf build machine par naya APK banate waqt MANUAL_MERGE.md ke steps follow karne hain. Is publish ke baad invite links Play Store verified app links ban jayenge.
