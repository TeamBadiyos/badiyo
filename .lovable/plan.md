# Native build: Razorpay sheet, Install Referrer, verified app links

Teen cheezein ek naye APK build me bundle karni hain, aur `native/android/MANUAL_MERGE.md` me exact steps likhni hain.

## Package verification (done — npm registry par check kiya)

| Kaam | Package | Status |
| --- | --- | --- |
| Razorpay native sheet | `capacitor-razorpay` v1.3.0 (Razorpay ka apna, author sachin.nautiyal@razorpay.com, Sep 2025, peer `@capacitor/core >=7`) | exists |
| Install Referrer | `@capgo/capacitor-install-referrer` v8.1.11 | exists |
| ~~`@capacitor-community/razorpay`~~ | npm par **exist nahi karta** (404) | hata denge |
| ~~`@capacitor-community/install-referrer`~~ | npm par **exist nahi karta** (404) | hata denge |

Plugin IDs source se confirm kiye: Razorpay ka Android class `Checkout` → plugin id **`Checkout`**, method `open(options)` → `{ response }`. Capgo ka `@CapacitorPlugin(name = "InstallReferrer")` → method `getReferrer()`.

## 1. Razorpay native sheet

- `src/lib/razorpayCheckout.ts` already `registerPlugin("Checkout")` karta hai aur `result.response ?? result` padhta hai — yeh asli package ke API se match karta hai, isliye code change minimal.
- Change: plugin missing hone par ab **chupchap** fallback nahi — `console.warn("[razorpay] native Checkout plugin missing, falling back to web sheet")` (dev log) ke saath web sheet chalega, taaki build me plugin chhoot jaye to pata chale.
- MANUAL_MERGE.md me package name `capacitor-razorpay` (galat community wala hata denge).

## 2. Install Referrer (Play Store se aaya referral code)

- Package `@capgo/capacitor-install-referrer`, plugin id `InstallReferrer`.
- Naya `src/lib/installReferrer.ts`:
  - pehle launch par ek hi baar `InstallReferrer.getReferrer()`,
  - referrer string ko `decodeURIComponent` karke `ref=CODE` parse (Play Store value URL-encoded aati hai),
  - agar koi code pehle se stored nahi hai to `src/lib/referrals.ts` ke storage me set,
  - `installreferrer_read` flag se dobara na pade,
  - plugin unavailable → `console.warn` (silent no-op nahi).
- Bootstrap se ek baar call (`src/routes/index.tsx` startup effect), sign-in se pehle.
- `src/routes/invite.$code.tsx`: Play Store URL me referrer value ab properly encode hogi → `...&referrer=ref%3DCODE`.

## 3. AndroidManifest — autoVerify intent filter + in-app routing

`android/app/src/main/AndroidManifest.xml` ke **MainActivity `<activity>`** block ke andar:

```xml
<intent-filter android:autoVerify="true">
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="https" android:host="user.badiyos.com" />
</intent-filter>
```

Existing `badiyos://open` filter waisa hi rahega. App side par `App.addListener("appUrlOpen", ...)` ko extend karenge: agar URL path `/invite/<CODE>` hai to code capture/apply hoga aur user home par land karega (Chrome hop ke bina).

## 4. assetlinks.json + SHA-256 fingerprint

- `public/.well-known/assetlinks.json` already sahi shape me hai: package `com.badiyos.customer`, `sha256_cert_fingerprints` ek **array** — yeh format hi rakhenge.
- Current fingerprint `BB:68:6C:…:5D:C3`. Yeh **Play App Signing** key ki honi chahiye (upload key ki nahi).
- Kahan se milegi (yeh aapko karna hoga): Play Console → app → **Test and release → Setup → App integrity → App signing key certificate → SHA-256 certificate fingerprint**.
- Alag nikle to mujhe bhej dein, main file update kar dunga; ek publish ke baad Android verification pass ho jayegi.

## 5. MANUAL_MERGE.md me likhe jaane wale checks

```bash
bun install
npm install capacitor-razorpay @capgo/capacitor-install-referrer
bun run build:capacitor
npx cap sync android
npx cap ls android        # dono plugins list me dikhne chahiye
```

App-links verification:

```bash
adb shell pm verify-app-links --re-verify com.badiyos.customer
adb shell pm get-app-links com.badiyos.customer
# output me: user.badiyos.com: verified   (agar "none"/"legacy_failure" hai to assetlinks fingerprint galat hai)
```

Plus Razorpay sheet verification steps (UPI apps dikhein, cancel par "Payment cancelled", ek real payment).

## Technical notes

- Files: `native/android/MANUAL_MERGE.md`, naya `src/lib/installReferrer.ts`, `src/lib/razorpayCheckout.ts` (warning), `src/routes/invite.$code.tsx` (encoded referrer), `src/routes/index.tsx` (bootstrap + appUrlOpen invite routing), zaroorat pade to `src/lib/referrals.ts` me ek setter export.
- Sandbox me native plugins install nahi honge; sab name se register hote hain aur missing par warning + fallback, isliye current published APK aur website bilkul waise hi chalenge.
- Verification: `bunx tsgo --noEmit` + production build.
- Design, pricing, GST, dispatch, rewards rules me koi badlav nahi.
