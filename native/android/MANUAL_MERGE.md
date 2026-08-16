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
