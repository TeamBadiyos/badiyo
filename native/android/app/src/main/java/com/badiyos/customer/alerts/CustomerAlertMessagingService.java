package com.badiyos.customer.alerts;

import android.app.ActivityManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.text.TextUtils;

import androidx.core.app.NotificationCompat;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Customer-facing full-screen alarm handler.
 *
 * Only three alert types are treated as alarms:
 *   - order_completed
 *   - reminder_10min
 *   - extension_decided
 *
 * Anything else (or anything received while the app is in the foreground)
 * is delegated to Capacitor's MessagingService for normal in-app handling.
 */
public class CustomerAlertMessagingService extends MessagingService {

    public static final String CHANNEL_ID = "customer_alerts";
    public static final String CHANNEL_NAME = "Service alerts";
    private static final int NOTIFICATION_ID = 4711;

    public static boolean isAlarmAlert(String alertType) {
        return "order_completed".equals(alertType)
                || "reminder_10min".equals(alertType)
                || "extension_decided".equals(alertType);
    }

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();
        String alertType = data.get("alert_type");

        if (!isAlarmAlert(alertType) || isAppInForeground()) {
            super.onMessageReceived(remoteMessage);
            return;
        }

        createChannel();

        String title = AlertCopy.title(alertType, data);
        String body = AlertCopy.body(alertType, data);

        Intent fullScreenIntent = new Intent(this, CustomerAlarmActivity.class);
        fullScreenIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        fullScreenIntent.putExtra(CustomerAlarmActivity.EXTRA_ALERT_TYPE, alertType);
        fullScreenIntent.putExtra(CustomerAlarmActivity.EXTRA_TITLE, title);
        fullScreenIntent.putExtra(CustomerAlarmActivity.EXTRA_BODY, body);
        fullScreenIntent.putExtra(CustomerAlarmActivity.EXTRA_SOUND_URL, data.get("sound_url"));
        fullScreenIntent.putExtra(CustomerAlarmActivity.EXTRA_BOOKING_ID, data.get("booking_id"));
        fullScreenIntent.putExtra(CustomerAlarmActivity.EXTRA_ROUTE, data.get("route"));

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pending = PendingIntent.getActivity(this, 0, fullScreenIntent, flags);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(getApplicationInfo().icon)
                .setContentTitle(title)
                .setContentText(body)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(true)
                .setContentIntent(pending)
                .setFullScreenIntent(pending, true);

        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(NOTIFICATION_ID, builder.build());
        }

        // Also try to launch the ringing screen directly (works when the app has
        // been used recently / has full-screen-intent permission).
        try {
            startActivity(fullScreenIntent);
        } catch (Exception ignored) {
            // Notification full-screen intent remains the fallback.
        }
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;

        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Time-critical alerts about your ongoing service");
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[]{0, 600, 400, 600});
        channel.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
        channel.setBypassDnd(true);
        // Sound is played by CustomerAlarmActivity (streamed from sound_url).
        channel.setSound(null, null);
        nm.createNotificationChannel(channel);
    }

    private boolean isAppInForeground() {
        ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
        if (am == null) return false;
        java.util.List<ActivityManager.RunningAppProcessInfo> procs = am.getRunningAppProcesses();
        if (procs == null) return false;
        String pkg = getPackageName();
        for (ActivityManager.RunningAppProcessInfo p : procs) {
            if (p.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
                    && !TextUtils.isEmpty(p.processName) && p.processName.equals(pkg)) {
                return true;
            }
        }
        return false;
    }
}
