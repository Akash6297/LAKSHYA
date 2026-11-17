package app.lakshya.jarvis;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import androidx.core.app.NotificationManagerCompat;
import org.json.JSONObject;

/** Fires scheduled alerts and handles their Snooze / Dismiss buttons. */
public class AlarmReceiver extends BroadcastReceiver {

    static final String ACTION_FIRE = "app.lakshya.jarvis.action.ALARM_FIRE";
    static final String ACTION_SNOOZE = "app.lakshya.jarvis.action.ALARM_SNOOZE";
    static final String ACTION_DISMISS = "app.lakshya.jarvis.action.ALARM_DISMISS";
    static final String EXTRA_ALARM = "alarm";

    @Override
    public void onReceive(Context c, Intent intent) {
        Uri data = intent.getData();
        String id = data == null ? null : data.getLastPathSegment();
        if (id == null) return;
        String action = intent.getAction();
        if (ACTION_FIRE.equals(action)) {
            JSONObject a = AlarmScheduler.take(c, id);
            if (a != null) Notifs.showAlert(c, a);
        } else if (ACTION_SNOOZE.equals(action) || ACTION_DISMISS.equals(action)) {
            NotificationManagerCompat.from(c).cancel(Notifs.idFor(id));
            if (ACTION_SNOOZE.equals(action)) snooze(c, intent.getStringExtra(EXTRA_ALARM), id);
        }
    }

    static void snooze(Context c, String json, String id) {
        try {
            JSONObject a = new JSONObject(json);
            a.put("id", id.endsWith(":snooze") ? id : id + ":snooze");
            a.put("at", System.currentTimeMillis() + 5 * 60_000L);
            a.put("repeatDaily", false);
            AlarmScheduler.add(c, a);
        } catch (Exception ignored) {}
    }
}
