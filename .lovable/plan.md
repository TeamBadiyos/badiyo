# Native build: Razorpay sheet, Install Referrer, verified app links

Teen cheezein ek hi naye APK build me bundle karni hain, aur `native/android/MANUAL_MERGE.md` me step-by-step likhni hain taaki build machine par bina guesswork ke chale.

## 1. Razorpay native sheet (already half-done)

Web side taiyaar hai (`src/lib/razorpayCheckout.ts` plugin id `Checkout` register karta hai, warna web sheet par fallback). Sirf build steps confirm karne hain in MANUAL_MERGE.md:

```
bun install
npm install @capacitor-community/razorpay
bun run build:capacitor
npx cap sync android
```

Yeh section already likha hai — isko naye consolidated "Native build checklist" ke andar la denge taaki teeno steps ek jagah hon.

## 2. Install Referrer (Play Store se aaya referral code)

- Plugin: `@capacitor-community/install-referrer` (npm install + `npx cap sync android`; Gradle `com.android.installreferrer:installreferrer` plugin khud le aata hai).
- Web side: naya helper `src/lib/installReferrer.ts` —
  - app ke pehle launch par ek hi baar plugin se referrer string padhta hai,
  - `ref=CODE` parse karta hai,
  - agar pehle se koi referral code stored nahi hai to `src/lib/referrals.ts` ke storage me daal deta hai,
  - `installreferrer_read` flag localStorage me set karta hai (dobara na padhe),
  - plugin na mile (web / purana APK) to chup-chaap skip.
- Call site: app bootstrap (`src/routes/index.tsx` ke startup effect) me ek baar, sign-in se pehle.
- Play Store link pehle se `?referrer=ref=CODE` bhejta hai (`src/routes/invite.$code.tsx`), to code end-to-end track hoga: link → Play Store → install → pehla launch → referral apply.

## 3. autoVerify intent filter for user.badiyos.com

MainActivity me add karna hai (MANUAL_MERGE.md me exact block):

```xml
<intent-filter android:autoVerify="true">
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="https" android:host="user.badiyos.com" />
</intent-filter>
```

Isse `https://user.badiyos.com/invite/CODE` Chrome me nahi, seedha app me khulega. Existing `badiyos://open` filter waisa hi rahega.

## 4. assetlinks.json + SHA-256 fingerprint

- File: `public/.well-known/assetlinks.json` — package pehle se `com.badiyos.customer` hai (sahi hai), isme koi badlav nahi.
- Fingerprint abhi `BB:68:6C:...:5D:C3` hai. Yeh **Play App Signing** wale key ka hona chahiye, upload key ka nahi.
- Kahan se milega (aap karenge, mere paas access nahi):
  Play Console → apna app → **Test and release → Setup → App integrity** → **App signing key certificate** → `SHA-256 certificate fingerprint` copy karein.
- Agar wo current value se alag nikla, mujhe bhej dein — main `assetlinks.json` update kar dunga (aur ek hi publish ke baad Android verification pass ho jayegi).
- MANUAL_MERGE.md me yeh jagah aur verification command bhi likhi jayegi:
  `adb shell pm verify-app-links --re-verify com.badiyos.customer` + `adb shell pm get-app-links com.badiyos.customer`.

## Technical notes

- Files changed: `native/android/MANUAL_MERGE.md` (naya "Native build checklist" section: dono npm plugins, manifest block, verification), naya `src/lib/installReferrer.ts`, chhota bootstrap call `src/routes/index.tsx`, aur `src/lib/referrals.ts` me ek exported setter agar zaroori hua.
- Koi plugin sandbox me install nahi hoga (registry 404) — sab kuch name se register hota hai aur missing hone par no-op, isliye current published APK aur website bilkul waise hi chalte rahenge.
- Verification: `bunx tsgo --noEmit` + production build.
- Design, pricing, GST, dispatch, rewards rules me koi badlav nahi.
