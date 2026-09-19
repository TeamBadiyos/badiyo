# Refer links seedha Play Store pe — tracking ke saath

## Problem

Refer & Earn screen ke chaaron buttons (Copy Link, WhatsApp, Share, QR) abhi `https://user.badiyos.com/invite/CODE` bhejte hain — link pehle website pe jaata hai, fir Play Store. Aur APK me Play install-referrer plugin bundled hi nahi hai (sirf manual-merge note hai), isliye Play Store se aaya referral code app me padha hi nahi ja sakta — tracking toot jaati hai.

## Goal

Har share action ka link seedha Play Store khole, referral code ke saath, aur install ke baad code automatically account se jud jaaye.

## Changes

### 1. Ek shared Play Store invite link (src/lib/referrals.ts)
- Naya helper `buildPlayStoreInviteUrl(code)`:
  `https://play.google.com/store/apps/details?id=com.badiyos.customer&referrer=ref%3D<CODE>`
- Play Store is `referrer` value ko install ke waqt Install Referrer API me pass karta hai — wahi tracking ka source hai.

### 2. Refer & Earn screen (src/components/ReferralDashboardScreen.tsx)
- Copy Link, WhatsApp, Share aur QR — chaaron ab upar wala Play Store link use karenge (QR code bhi wahi URL encode karega).
- Share text update: "Join badiyos... use my code CODE: <play-store-link>".
- Purana `INVITE_BASE_URL` (user.badiyos.com) share links se hat jaayega.

### 3. Tracking ka dusra sira fix — plugin bundle karo
- `bun add @capgo/capacitor-install-referrer` — contacts plugin ki tarah ab ye project dependency banega, `npx cap sync android` se APK me aa jaayega.
- App start ka existing code (`captureInstallReferrer()` in src/routes/index.tsx) install ke baad `ref=CODE` padhkar code store karega; signup/login ke waqt `linkReferralIfAny()` use account se jod dega. Ye flow pehle se likha hai — bas plugin missing tha.
- MANUAL_MERGE.md note update: plugin ab dependency me hai, manual step redundant.

### 4. Single source of truth
- `src/routes/invite.$code.tsx` ka apna `playStoreUrl()` hatakar wahi shared helper use karega (kabhi alag format na ban jaaye).

### 5. Purane links bhi chalte rahenge
- Pehle share hue `user.badiyos.com/invite/CODE` links ka page waise hi rahega (installed app handoff → warna Play Store + code). Koi purana link dead nahi hoga.

## Behaviour after change

- Dost ke phone pe link tap → seedha Play Store ka badiyos page khulta hai (app installed hai to bhi Play Store page hi khulega, "Open" button ke saath).
- Install + pehli baar open → referral code automatically jud jaata hai, kuch type karne ki zaroorat nahi.
- Referrer ko reward tabhi milta hai jab dost apna pehla booking complete kare (existing rule, no change).

## Prerequisites / notes

- Ye link tabhi kaam karega jab app Play Store pe `com.badiyos.customer` package se live ho. Agar listing abhi live nahi hai, link pe "Not found" aayega — app pehle Play Store pe publish karna hoga. (Aap bata dena agar listing live hai ya nahi; code change dono haalat me sahi rahega.)
- Web/desktop pe share kiya gaya link browser me Play Store page kholega — expected.
- Koi pricing/reward/database change nahi; sirf link generation + plugin bundling.

## Technical details

- Helper: `encodeURIComponent('ref=' + code)` — Play decoded value Install Referrer API ko deta hai; `parseReferralCodeFromReferrer` (existing) `ref=CODE` parse karta hai.
- Files: src/lib/referrals.ts, src/components/ReferralDashboardScreen.tsx, src/routes/invite.$code.tsx, package.json, native/android/MANUAL_MERGE.md.
- Verify: `bunx tsgo --noEmit`, `bun run build`; QR/Copy/WhatsApp/Share ka URL Play Store format me dikhna chahiye.
