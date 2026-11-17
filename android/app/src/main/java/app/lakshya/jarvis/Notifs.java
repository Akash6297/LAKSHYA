package app.lakshya.jarvis;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import java.util.Arrays;
import org.json.JSONObject;

/** Notification channels and the alert / prompt notifications Jarvis posts. */
final class Notifs {

    static final String CH_LISTEN = "jarvis_listening";
    static final String CH_RING = "jarvis_ring";
    static final String CH_REMIND = "jarvis_reminders";
    static final String CH_WAKE = "jarvis_wake";
    static final String CH_SYSTEM = "jarvis_system";

    private static final int FLAGS = PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT;

    private Notifs() {}

    static void ensureChannels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return;

        NotificationChannel listen = new NotificationChannel(CH_LISTEN, "Wake word listening", NotificationManager.IMPORTANCE_MIN);
        listen.setDescription("Shown while Jarvis listens for “Hey Jarvis”.");
        listen.setShowBadge(false);

        NotificationChannel ring = new NotificationChannel(CH_RING, "Ringing alerts", NotificationManager.IMPORTANCE_HIGH);
        ring.setDescription("Meetings, exams, deadlines and urgent reminders. Rings until you respond.");
        ring.setSound(
            RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM),
            new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
        );
        ring.enableVibration(true);
        ring.setVibrationPattern(new long[] { 0, 800, 400, 800, 400, 800 });
        ring.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

        NotificationChannel remind = new NotificationChannel(CH_REMIND, "Reminders", NotificationManager.IMPORTANCE_HIGH);
        remind.setDescription("Event, task and study reminders.");

        NotificationChannel wake = new NotificationChannel(CH_WAKE, "Jarvis wake-up", NotificationManager.IMPORTANCE_HIGH);
        wake.setDescription("Opens Jarvis after you say the wake word.");
        wake.setSound(null, null);

        NotificationChannel sys = new NotificationChannel(CH_SYSTEM, "Jarvis status", NotificationManager.IMPORTANCE_DEFAULT);

        nm.createNotificationChannels(Arrays.asList(listen, ring, remind, wake, sys));
    }

    static int idFor(String key) {
        return 5000 + ((key.hashCode() & 0x7fffffff) % 1_000_000);
    }

    static boolean canNotify(Context c) {
        return Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    static PendingIntent openApp(Context c, String route, int requestCode) {
        Intent i = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (route != null && !route.isEmpty()) i.setAction(MainActivity.ACTION_OPEN).putExtra(MainActivity.EXTRA_ROUTE, route);
        return PendingIntent.getActivity(c, requestCode, i, FLAGS);
    }

    private static PendingIntent receiver(Context c, String action, JSONObject a, int requestCode) {
        Intent i = new Intent(c, AlarmReceiver.class)
            .setAction(action)
            .setData(AlarmScheduler.uriFor(a.optString("id")))
            .putExtra(AlarmReceiver.EXTRA_ALARM, a.toString());
        return PendingIntent.getBroadcast(c, requestCode, i, FLAGS);
    }

    /** A reminder: normal heads-up, or "ring" = looping alarm sound + full-screen like a call. */
    @SuppressLint("MissingPermission")
    static void showAlert(Context c, JSONObject a) {
        if (!canNotify(c)) return;
        String id = a.optString("id");
        boolean ring = a.optBoolean("ring");
        String title = a.optString("title", "Reminder");
        String body = a.optString("body", "");
        String url = a.optString("url", "");
        int nid = idFor(id);

        NotificationCompat.Builder b = new NotificationCompat.Builder(c, ring ? CH_RING : CH_REMIND)
            .setSmallIcon(R.drawable.ic_stat_jarvis)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(openApp(c, a.optString("route", ""), nid))
            .setAutoCancel(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(ring ? NotificationCompat.PRIORITY_MAX : NotificationCompat.PRIORITY_HIGH)
            .setCategory(ring ? NotificationCompat.CATEGORY_ALARM : NotificationCompat.CATEGORY_REMINDER);

        if (!url.isEmpty()) {
            Intent join = new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            b.addAction(0, "Join", PendingIntent.getActivity(c, nid + 3, join, FLAGS));
        }
        b.addAction(0, "Snooze 5 min", receiver(c, AlarmReceiver.ACTION_SNOOZE, a, nid + 1));
        if (ring) {
            b.addAction(0, "Dismiss", receiver(c, AlarmReceiver.ACTION_DISMISS, a, nid + 2));
            b.setOngoing(true).setTimeoutAfter(10 * 60_000L);
            Intent full = new Intent(c, AlarmActivity.class)
                .putExtra(AlarmReceiver.EXTRA_ALARM, a.toString())
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION);
            b.setFullScreenIntent(PendingIntent.getActivity(c, nid + 4, full, FLAGS), true);
            if (Build.VERSION.SDK_INT < 26) b.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM), AudioManager.STREAM_ALARM);
        }
        Notification n = b.build();
        if (ring) n.flags |= Notification.FLAG_INSISTENT; // keep ringing until answered
        NotificationManagerCompat.from(c).notify(nid, n);
    }

    /** Fallback when Jarvis may not open itself from the background: tap (or full screen when locked). */
    @SuppressLint("MissingPermission")
    static void showWakePrompt(Context c, Intent activityIntent) {
        if (!canNotify(c)) return;
        PendingIntent pi = PendingIntent.getActivity(c, 7001, activityIntent, FLAGS);
        Notification n = new NotificationCompat.Builder(c, CH_WAKE)
            .setSmallIcon(R.drawable.ic_stat_jarvis)
            .setContentTitle("Jarvis is ready")
            .setContentText("Tap to talk")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setContentIntent(pi)
            .setFullScreenIntent(pi, true)
            .setAutoCancel(true)
            .setTimeoutAfter(20_000)
            .build();
        NotificationManagerCompat.from(c).notify(7001, n);
    }

    static void cancelWakePrompt(Context c) {
        NotificationManagerCompat.from(c).cancel(7001);
    }

    /** After a reboot or update Android does not allow restarting the microphone in the background. */
    @SuppressLint("MissingPermission")
    static void showRestartPrompt(Context c) {
        if (!canNotify(c)) return;
        Notification n = new NotificationCompat.Builder(c, CH_SYSTEM)
            .setSmallIcon(R.drawable.ic_stat_jarvis)
            .setContentTitle("Turn Jarvis listening back on")
            .setContentText("Android paused the wake word after a restart. Tap to resume.")
            .setContentIntent(openApp(c, null, 7002))
            .setAutoCancel(true)
            .build();
        NotificationManagerCompat.from(c).notify(7002, n);
    }
}
