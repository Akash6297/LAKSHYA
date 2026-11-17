package app.lakshya.jarvis;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;

/** Small persisted state shared by the plugin, the listening service and the receivers. */
final class JarvisPrefs {

    private static final String NAME = "jarvis";
    static final List<String> DEFAULT_PHRASES = Arrays.asList("hey jarvis", "hey lakshya", "radhe radhe jarvis", "radhe radhe lakshya");

    private JarvisPrefs() {}

    static SharedPreferences get(Context c) {
        return c.getApplicationContext().getSharedPreferences(NAME, Context.MODE_PRIVATE);
    }

    static void saveWake(Context c, List<String> phrases, String mode, float threshold, boolean allowOnLockScreen) {
        JSONArray a = new JSONArray();
        for (String p : phrases) a.put(p);
        get(c)
            .edit()
            .putString("wake.phrases", a.toString())
            .putString("wake.mode", mode)
            .putFloat("wake.threshold", threshold)
            .putBoolean("wake.enabled", true)
            .putBoolean("lock.allow", allowOnLockScreen)
            .apply();
    }

    static void setWakeEnabled(Context c, boolean on) {
        get(c).edit().putBoolean("wake.enabled", on).apply();
    }

    static boolean wakeEnabled(Context c) {
        return get(c).getBoolean("wake.enabled", false);
    }

    static List<String> phrases(Context c) {
        List<String> out = new ArrayList<>();
        try {
            JSONArray a = new JSONArray(get(c).getString("wake.phrases", "[]"));
            for (int i = 0; i < a.length(); i++) out.add(a.getString(i));
        } catch (JSONException ignored) {}
        return out.isEmpty() ? new ArrayList<>(DEFAULT_PHRASES) : out;
    }

    static String mode(Context c) {
        return get(c).getString("wake.mode", "always");
    }

    static float threshold(Context c) {
        return get(c).getFloat("wake.threshold", 0.55f);
    }

    static boolean allowOnLockScreen(Context c) {
        return get(c).getBoolean("lock.allow", false);
    }

    static String alarms(Context c) {
        return get(c).getString("alarms", "[]");
    }

    static void setAlarms(Context c, String json) {
        get(c).edit().putString("alarms", json).apply();
    }
}
