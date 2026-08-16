package com.badiyos.customer.alerts;

import android.app.KeyguardManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.text.TextUtils;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

/**
 * Full-screen ringing screen for customer alerts.
 * Shows over the lock screen, streams the alarm sound from `sound_url`,
 * auto-dismisses after 20 seconds, and deep-links into the booking on tap.
 */
public class CustomerAlarmActivity extends AppCompatActivity {

    public static final String EXTRA_ALERT_TYPE = "alert_type";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_BODY = "body";
    public static final String EXTRA_SOUND_URL = "sound_url";
    public static final String EXTRA_BOOKING_ID = "booking_id";
    public static final String EXTRA_ROUTE = "route";

    private static final long AUTO_DISMISS_MS = 20_000L;

    private MediaPlayer player;
    private Vibrator vibrator;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable autoDismiss = new Runnable() {
        @Override public void run() { finishAlarm(false); }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        showOverLockScreen();
        setContentView(R.layout.activity_customer_alarm);

        Intent intent = getIntent();
        String title = intent.getStringExtra(EXTRA_TITLE);
        String body = intent.getStringExtra(EXTRA_BODY);

        ((TextView) findViewById(R.id.alarm_title))
                .setText(TextUtils.isEmpty(title) ? "badiyos" : title);
        ((TextView) findViewById(R.id.alarm_body))
                .setText(TextUtils.isEmpty(body) ? "" : body);

        Button ok = findViewById(R.id.alarm_ok);
        ok.setOnClickListener(v -> finishAlarm(false));
        findViewById(R.id.alarm_card).setOnClickListener(v -> finishAlarm(true));

        startSound(intent.getStringExtra(EXTRA_SOUND_URL));
        startVibration();
        handler.postDelayed(autoDismiss, AUTO_DISMISS_MS);
    }

    private void showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (km != null) km.requestDismissKeyguard(this, null);
        } else {
            getWindow().addFlags(
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                            | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                            | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    private void startSound(String soundUrl) {
        if (TextUtils.isEmpty(soundUrl)) return;
        try {
            player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
            player.setDataSource(this, Uri.parse(soundUrl));
            player.setLooping(true);
            player.setOnPreparedListener(MediaPlayer::start);
            player.setOnErrorListener((mp, what, extra) -> true);
            player.prepareAsync();

            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                am.setStreamVolume(AudioManager.STREAM_ALARM,
                        am.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0);
            }
        } catch (Exception ignored) {
            releasePlayer();
        }
    }

    private void startVibration() {
        vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        if (vibrator == null || !vibrator.hasVibrator()) return;
        long[] pattern = {0, 600, 400, 600, 400};
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
        } else {
            vibrator.vibrate(pattern, 0);
        }
    }

    private void finishAlarm(boolean openBooking) {
        handler.removeCallbacks(autoDismiss);
        stopEverything();

        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancelAll();

        if (openBooking) {
            String bookingId = getIntent().getStringExtra(EXTRA_BOOKING_ID);
            String route = getIntent().getStringExtra(EXTRA_ROUTE);
            if (TextUtils.isEmpty(route) && !TextUtils.isEmpty(bookingId)) {
                route = "/booking/" + bookingId;
            }
            Intent open = new Intent(Intent.ACTION_VIEW,
                    Uri.parse("badiyos://open" + (TextUtils.isEmpty(route) ? "/" : route)));
            open.setPackage(getPackageName());
            open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            try {
                startActivity(open);
            } catch (Exception ignored) {
                Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
                if (launch != null) startActivity(launch);
            }
        }
        finish();
    }

    private void stopEverything() {
        releasePlayer();
        if (vibrator != null) {
            vibrator.cancel();
            vibrator = null;
        }
    }

    private void releasePlayer() {
        if (player == null) return;
        try {
            if (player.isPlaying()) player.stop();
        } catch (Exception ignored) {}
        player.release();
        player = null;
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(autoDismiss);
        stopEverything();
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        finishAlarm(false);
    }
}
