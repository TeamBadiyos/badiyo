package com.badiyos.customer.alerts;

import android.text.TextUtils;

import java.util.Map;

/** Title/body copy for the 3 customer alarm alert types. */
public final class AlertCopy {

    private AlertCopy() {}

    public static String title(String alertType, Map<String, String> data) {
        String override = data != null ? data.get("title") : null;
        if (!TextUtils.isEmpty(override)) return override;

        if ("order_completed".equals(alertType)) return "Your service is complete!";
        if ("reminder_10min".equals(alertType)) return "10 minutes left on your service";
        if ("extension_decided".equals(alertType)) {
            return isAccepted(data)
                    ? "Extension accepted"
                    : "Extension declined";
        }
        return "badiyos";
    }

    public static String body(String alertType, Map<String, String> data) {
        String override = data != null ? data.get("body") : null;
        if (!TextUtils.isEmpty(override)) return override;

        if ("order_completed".equals(alertType)) {
            return "Tap to review your booking and rate your expert.";
        }
        if ("reminder_10min".equals(alertType)) {
            return "Your expert will finish soon. Need more time? You can request an extension.";
        }
        if ("extension_decided".equals(alertType)) {
            return isAccepted(data)
                    ? "Your expert accepted the extra time. Your service continues."
                    : "Your expert could not accept the extra time. Your service ends as scheduled.";
        }
        return "Tap to open badiyos.";
    }

    private static boolean isAccepted(Map<String, String> data) {
        if (data == null) return false;
        String decision = data.get("decision");
        if (decision == null) decision = data.get("extension_status");
        if (decision == null) decision = data.get("status");
        return decision != null
                && ("accepted".equalsIgnoreCase(decision)
                    || "approved".equalsIgnoreCase(decision)
                    || "true".equalsIgnoreCase(decision));
    }
}
