# Customer full-screen alert alarm — Android manual merge

These are hand-authored native sources only. Run `npx cap add android` locally
first, then copy these files in and apply the manifest merge block below.

## 1. Files to copy (after `npx cap add android`)

| From (this repo) | To (generated Android project) |
| --- | --- |
| `native/android/app/src/main/java/com/badiyos/customer/alerts/CustomerAlertMessagingService.java` | `android/app/src/main/java/com/badiyos/customer/alerts/` |
| `native/android/app/src/main/java/com/badiyos/customer/alerts/CustomerAlarmActivity.java` | `android/app/src/main/java/com/badiyos/customer/alerts/` |
| `native/android/app/src/main/java/com/badiyos/customer/alerts/AlertCopy.java` | `android/app/src/main/java/com/badiyos/customer/alerts/` |
| `native/android/app/src/main/res/layout/activity_customer_alarm.xml` | `android/app/src/main/res/layout/` |
| `native/android/app/src/main/res/values/colors_alerts.xml` | `android/app/src/main/res/values/` |

`CustomerAlarmActivity` imports `R` from the app package. If your applicationId
differs from `com.badiyos.customer`, add `import <applicationId>.R;` at the top.

## 2. AndroidManifest.xml — MANUAL MERGE BLOCK

Add the permissions inside `<manifest>` (above `<application>`):

```xml
<!-- BEGIN badiyos customer alerts -->
<uses-permission android:name="android.permission.USE_FULL_SCREEN_INTENT" />
<uses-permission android:name="android.permission.VIBRATE" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.DISABLE_KEYGUARD" />
<uses-permission android:name="android.permission.INTERNET" />
<!-- Required for "Use current location" / map pin detection -->
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<!-- END badiyos customer alerts -->
```

Add inside `<application>`:

```xml
<!-- BEGIN badiyos customer alerts -->
<service
    android:name="com.badiyos.customer.alerts.CustomerAlertMessagingService"
    android:exported="false">
    <intent-filter>
        <action android:name="com.google.firebase.MESSAGING_EVENT" />
    </intent-filter>
</service>

<activity
    android:name="com.badiyos.customer.alerts.CustomerAlarmActivity"
    android:exported="false"
    android:launchMode="singleInstance"
    android:excludeFromRecents="true"
    android:showOnLockScreen="true"
    android:turnScreenOn="true"
    android:showWhenLocked="true"
    android:taskAffinity=""
    android:theme="@style/Theme.AppCompat.NoActionBar" />
<!-- END badiyos customer alerts -->
```

Also add the deep-link intent filter to the existing `MainActivity` (so the
"tap to open booking" action lands on the right screen):

```xml
<intent-filter>
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="badiyos" android:host="open" />
</intent-filter>
```

If Capacitor's default push service (`com.getcapacitor.plugin.PushNotifications.MessagingService`)
is declared in the merged manifest, our service takes priority because it is
declared explicitly in the app manifest; no removal is required, but you may add
`tools:node="remove"` on the plugin service if the alarm never fires.

## 3. Gradle

No extra dependencies: `firebase-messaging`, `appcompat` and the Capacitor push
plugin are already pulled in by `@capacitor/push-notifications` and the
Capacitor Android platform. Ensure `google-services.json` is at `android/app/`.

## 4. Payload contract (send from the backend)

Send a **data-only** FCM message (no `notification` block) so the service runs:

```json
{
  "data": {
    "alert_type": "order_completed | reminder_10min | extension_decided",
    "booking_id": "<uuid>",
    "route": "/booking/<uuid>",
    "sound_url": "<signed URL to the alarm audio>",
    "decision": "accepted | declined"        // extension_decided only
  },
  "android": { "priority": "HIGH" }
}
```

Optional `title` / `body` keys in `data` override the built-in copy.

## 5. Behaviour

- App foreground → delegated to Capacitor (in-app toast handling in `src/lib/push.ts`).
- App background/killed + one of the 3 alert types → high-importance
  `customer_alerts` channel notification with `setFullScreenIntent`,
  `CATEGORY_CALL`, `setOngoing(true)`, launching `CustomerAlarmActivity`.
- Alarm screen: shows over the lock screen, turns the screen on, streams
  `sound_url` on the ALARM stream (looping) + vibration, single **OK** button,
  auto-dismiss after 20 s, tap anywhere → deep link `badiyos://open/booking/<id>`.

---

# Native build checklist (run once, produces the new APK)

Three things ship together in this build:

1. **Razorpay native payment sheet** — `capacitor-razorpay` (Razorpay's own
   package, plugin id `Checkout`).
2. **Play Install Referrer** — `@capgo/capacitor-install-referrer`
   (plugin id `InstallReferrer`).
3. **Verified app links** for `user.badiyos.com` (`autoVerify` intent filter).

Both plugins are registered BY NAME in the web code
(`src/lib/razorpayCheckout.ts`, `src/lib/installReferrer.ts`), so the web
bundle needs no npm dependency and the currently published APK keeps working.
If a plugin is missing at runtime the app logs a `console.warn` (never a silent
no-op) and falls back.

## 1. Install + sync

Version note: this project runs **Capacitor 8** (`@capacitor/core` 8.x), so pin
the Capgo plugin to its Capacitor-8 line — `@capgo/capacitor-install-referrer@^8`
(e.g. 8.1.11). A `@^7` or older build targets Capacitor 7 and will not sync
cleanly. `capacitor-razorpay` 1.3.x is Capacitor-version agnostic.

```bash
bun install
npm install capacitor-razorpay "@capgo/capacitor-install-referrer@^8"
bun run build:capacitor
npx cap sync android
npx cap ls android
```

`npx cap ls android` MUST list both plugins, e.g.:

```
capacitor-razorpay@1.3.0
@capgo/capacitor-install-referrer@8.x
```

If either one is missing, the sync did not pick it up — re-run
`npm install` in the project root and `npx cap sync android` again.
`cap sync` also pulls Razorpay's Android SDK and
`com.android.installreferrer:installreferrer` through Gradle.

## 2. AndroidManifest.xml — verified app links

Add this **inside the existing `MainActivity` `<activity>` element** in
`android/app/src/main/AndroidManifest.xml` (next to the existing
`badiyos://open` filter, which stays as-is):

```xml
<!-- BEGIN badiyos verified app links -->
<intent-filter android:autoVerify="true">
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="https" android:host="user.badiyos.com" />
</intent-filter>
<!-- END badiyos verified app links -->
```

With this, `https://user.badiyos.com/invite/CODE` opens the app instead of
Chrome. The app handles it in `src/routes/index.tsx` (`appUrlOpen` +
`App.getLaunchUrl()`): the invite code is stored and applied at sign-in.

## 3. ProGuard / R8 (release builds only)

Release APKs run R8 minification (`minifyEnabled true` in
`android/app/build.gradle`). Razorpay's Android SDK talks to its web layer
through `@JavascriptInterface` reflection — if R8 strips those methods the
native sheet opens but payments silently fail. Add to
`android/app/proguard-rules.pro`:

```proguard
# Razorpay
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.razorpay.** { *; }
-dontwarn com.razorpay.**
```

If the release build ever shows the sheet closing instantly or a payment that
never returns, this file is the first place to check.

## 4. assetlinks.json / SHA-256 fingerprint

`public/.well-known/assetlinks.json` is served from
`https://user.badiyos.com/.well-known/assetlinks.json` and must contain:

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "com.badiyos.customer",
    "sha256_cert_fingerprints": ["AA:BB:..."]
  }
}]
```

The fingerprint must be the **Play App Signing** certificate, NOT the upload
key. The currently published value is
`A8:82:51:BE:D1:8B:58:74:FB:E0:32:B7:A9:1B:DC:F5:65:7C:D1:4F:29:9A:01:69:4F:5B:A8:3C:02:1A:B4:A6`.
Get it from:

> Play Console → badiyos → **Test and release → Setup → App integrity** →
> **App signing key certificate** → `SHA-256 certificate fingerprint`

Copy that value into the `sha256_cert_fingerprints` array (the array may hold
more than one entry if you also want debug builds to verify:
`keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey
-storepass android`).

## 5. Verify after installing the new APK

App links:

```bash
adb shell pm verify-app-links --re-verify com.badiyos.customer
adb shell pm get-app-links com.badiyos.customer
```

The output must show:

```
com.badiyos.customer:
    ID: ...
    Signatures: [...]
    Domain verification state:
      user.badiyos.com: verified
```

`none`, `legacy_failure` or `1024` (verification failed) means the served
`assetlinks.json` fingerprint or package name does not match the installed
build — fix assetlinks, republish, then re-run the two commands.

Razorpay sheet:

1. Open a booking and tap Pay.
2. Razorpay's **native** sheet appears (not the web page inside the app).
3. The UPI section lists the UPI apps installed on the phone.
4. Cancel once — the app shows "Payment cancelled" and returns to the summary.
5. Complete one real payment — booking is created and tracking opens.

Extension top-ups and tips on the live service screen use the same helper and
are covered by the same build.

Install referrer:

1. Uninstall the app, open an invite link on the phone, install from the Play
   Store page it lands on (URL carries `referrer=ref%3DCODE`).
2. First launch, then sign up — the referral must show under the inviter's
   "Joined" count.
3. Logcat should show no `[installReferrer]` warning.

## Contacts picker (pickup / drop contact)

The parcel booking screen has a "From contacts" button next to each contact
block. On the web it uses the browser Contact Picker API; on Android it uses
`@capacitor-community/contacts`, which is already a project dependency — so
`npx cap sync android` wires the plugin in automatically. No install step.

1. Add the permission to `android/app/src/main/AndroidManifest.xml`, inside
   `<manifest>` and above `<application>`:

   ```xml
   <uses-permission android:name="android.permission.READ_CONTACTS" />
   ```

2. Nothing else is required — the app requests the permission only when the
   user taps "From contacts". When the plugin or the browser API is missing
   (desktop browser, older APK) the button is hidden and manual typing is the
   only path; denying the permission shows a message and keeps typing available.

Verify:

1. Open Send Parcel, tap "From contacts" on Pickup contact.
2. Android asks for contacts permission the first time; allow it.
3. Pick a contact — name and the last 10 digits of the number fill in.
4. Deny the permission once — a message appears and manual typing still works.
