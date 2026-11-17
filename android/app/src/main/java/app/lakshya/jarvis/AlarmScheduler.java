package app.lakshya.jarvis;

import android.annotation.SuppressLint;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Phone alerts planned by the web app (src/features/jarvis/alarms.ts), scheduled
 * with AlarmManager so they fire with the app closed, offline and in Doze.
 * The list is stored so it survives reboots.
 */
final class AlarmScheduler {

    private static final long DAY = 24L * 60 * 60 * 1000;

    private AlarmScheduler() {}

    static Uri uriFor(String id) {
        return Uri.parse("jarvis://alarm/" + Uri.encode(id));
    }

    private static PendingIntent fireIntent(Context c, String id) {
        Intent i = new Intent(c, AlarmReceiver.class).setAction(AlarmReceiver.ACTION_FIRE).setData(uriFor(id));
        return PendingIntent.getBroadcast(c, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    static JSONArray load(Context c) {
        try {
            return new JSONArray(JarvisPrefs.alarms(c));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    /** Replace every scheduled alert with this list. Returns how many are scheduled. */
    static synchronized int replaceAll(Context c, JSONArray list) {
        AlarmManager am = c.getSystemService(AlarmManager.class);
        if (am == null) return 0;
        JSONArray old = load(c);
        for (int i = 0; i < old.length(); i++) {
            JSONObject a = old.optJSONObject(i);
            if (a != null) am.cancel(fireIntent(c, a.optString("id")));
        }
        JSONArray kept = new JSONArray();
        long now = System.currentTimeMillis();
        for (int i = 0; i < list.length(); i++) {
            JSONObject a = list.optJSONObject(i);
            if (a == null || a.optLong("at") <= now) continue;
            schedule(c, am, a);
            kept.put(a);
        }
        JarvisPrefs.setAlarms(c, kept.toString());
        return kept.length();
    }

    /** Add one alert (e.g. a snooze) without touching the others. */
    static synchronized void add(Context c, JSONObject a) {
        AlarmManager am = c.getSystemService(AlarmManager.class);
        if (am == null) return;
        JSONArray all = load(c);
        all.put(a);
        JarvisPrefs.setAlarms(c, all.toString());
        schedule(c, am, a);
    }

    /** The alert that just fired: removed, or moved to tomorrow if it repeats daily. */
    static synchronized JSONObject take(Context c, String id) {
        JSONArray all = load(c);
        JSONArray rest = new JSONArray();
        JSONObject found = null;
        for (int i = 0; i < all.length(); i++) {
            JSONObject a = all.optJSONObject(i);
            if (a == null) continue;
            if (found == null && id.equals(a.optString("id"))) {
                found = a;
                if (a.optBoolean("repeatDaily")) {
                    try {
                        JSONObject next = new JSONObject(a.toString());
                        long at = a.optLong("at");
                        while (at <= System.currentTimeMillis()) at += DAY;
                        next.put("at", at);
                        rest.put(next);
                        AlarmManager am = c.getSystemService(AlarmManager.class);
                        if (am != null) schedule(c, am, next);
                    } catch (JSONException ignored) {}
                }
            } else {
                rest.put(a);
            }
        }
        JarvisPrefs.setAlarms(c, rest.toString());
        return found;
    }

    /** After a reboot / app update every alarm has to be set again. */
    static synchronized void restoreAll(Context c) {
        AlarmManager am = c.getSystemService(AlarmManager.class);
        if (am == null) return;
        JSONArray all = load(c);
        JSONArray kept = new JSONArray();
        long now = System.currentTimeMillis();
        for (int i = 0; i < all.length(); i++) {
            JSONObject a = all.optJSONObject(i);
            if (a == null) continue;
            try {
                long at = a.optLong("at");
                if (a.optBoolean("repeatDaily")) {
                    while (at <= now) at += DAY;
                    a.put("at", at);
                }
                if (at <= now) continue;
                schedule(c, am, a);
                kept.put(a);
            } catch (JSONException ignored) {}
        }
        JarvisPrefs.setAlarms(c, kept.toString());
    }

    @SuppressLint({ "ScheduleExactAlarm", "MissingPermission" })
    private static void schedule(Context c, AlarmManager am, JSONObject a) {
        PendingIntent pi = fireIntent(c, a.optString("id"));
        long at = a.optLong("at");
        boolean exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms();
        try {
            if (exact && a.optBoolean("ring")) {
                // shows the alarm icon and is exempt from battery saving: used for the "call-like" alerts
                am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, Notifs.openApp(c, a.optString("route", ""), 9000)), pi);
            } else if (exact) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            } else {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            }
        } catch (SecurityException e) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        }
    }
}
