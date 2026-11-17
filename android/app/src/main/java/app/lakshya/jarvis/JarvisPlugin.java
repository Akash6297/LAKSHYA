package app.lakshya.jarvis;

import android.Manifest;
import android.app.AlarmManager;
import android.app.KeyguardManager;
import android.app.NotificationManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.AlarmClock;
import android.provider.Settings;
import android.speech.SpeechRecognizer;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;

/** The JavaScript ↔ Android bridge for Jarvis (see src/features/jarvis/native.ts). */
@CapacitorPlugin(
    name = "Jarvis",
    permissions = {
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }),
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class JarvisPlugin extends Plugin {

    private static volatile JarvisPlugin instance;
    private static volatile LaunchInfo pending;

    private SpeechHelper speech;
    private TtsHelper tts;

    @Override
    public void load() {
        instance = this;
        Notifs.ensureChannels(getContext());
        speech = new SpeechHelper(this);
        tts = new TtsHelper(getContext());
    }

    @Override
    protected void handleOnDestroy() {
        if (instance == this) instance = null;
        if (speech != null && getActivity() != null) getActivity().runOnUiThread(speech::destroy);
        if (tts != null) tts.shutdown();
    }

    /** From MainActivity / the wake service: tell the web app, or keep it until the app asks. */
    static void deliver(LaunchInfo info) {
        JarvisPlugin p = instance;
        String event = info.isWake() ? "wake" : "launch";
        if (p != null && p.hasListeners(event)) {
            pending = null;
            p.notifyListeners(event, info.toJS());
        } else {
            pending = info;
        }
    }

    static void emitUnlocked() {
        JarvisPlugin p = instance;
        if (p != null) p.notifyListeners("unlocked", new JSObject());
    }

    void emit(String event, JSObject data) {
        notifyListeners(event, data);
    }

    @PluginMethod
    public void consumeLaunch(PluginCall call) {
        LaunchInfo p = pending;
        pending = null;
        call.resolve(p == null ? new JSObject() : p.toJS());
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        Context c = getContext();
        JSObject perms = new JSObject();
        perms.put("microphone", getPermissionState("microphone") == PermissionState.GRANTED);
        perms.put("notifications", NotificationManagerCompat.from(c).areNotificationsEnabled());
        perms.put("overlay", Settings.canDrawOverlays(c));
        PowerManager pm = c.getSystemService(PowerManager.class);
        perms.put("batteryUnrestricted", pm != null && pm.isIgnoringBatteryOptimizations(c.getPackageName()));
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        perms.put("fullScreen", Build.VERSION.SDK_INT < 34 || (nm != null && nm.canUseFullScreenIntent()));
        AlarmManager am = c.getSystemService(AlarmManager.class);
        perms.put("exactAlarms", Build.VERSION.SDK_INT < 31 || (am != null && am.canScheduleExactAlarms()));

        KeyguardManager km = c.getSystemService(KeyguardManager.class);
        JSObject r = new JSObject();
        r.put("sdk", Build.VERSION.SDK_INT);
        r.put("manufacturer", Build.MANUFACTURER);
        r.put("model", Build.MODEL);
        r.put("permissions", perms);
        r.put("wake", wakeStatus());
        r.put("locked", km != null && km.isKeyguardLocked());
        r.put("speechAvailable", SpeechRecognizer.isRecognitionAvailable(c));
        call.resolve(r);
    }

    private JSObject wakeStatus() {
        JSObject w = new JSObject();
        w.put("running", WakeWordService.running);
        w.put("paused", WakeWordService.paused);
        w.put("listening", WakeWordService.listening);
        w.put("modelReady", WakeWordService.modelReady);
        JSArray unknown = new JSArray();
        for (String s : WakeWordService.unknownWords) unknown.put(s);
        w.put("unknownWords", unknown);
        if (WakeWordService.error != null) w.put("error", WakeWordService.error);
        return w;
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        String kind = call.getString("kind", "microphone");
        if ("notifications".equals(kind) && Build.VERSION.SDK_INT < 33) {
            boolean on = NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
            if (!on) startSettings(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName()));
            resolveGranted(call, on);
            return;
        }
        String alias = "notifications".equals(kind) ? "notifications" : "microphone";
        if (getPermissionState(alias) == PermissionState.GRANTED) {
            resolveGranted(call, true);
            return;
        }
        requestPermissionForAlias(alias, call, "permissionCallback");
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        String alias = "notifications".equals(call.getString("kind")) ? "notifications" : "microphone";
        boolean granted = getPermissionState(alias) == PermissionState.GRANTED;
        // permanently denied: the system no longer shows the prompt, so open the app's settings
        if (!granted) startSettings(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName())));
        resolveGranted(call, granted);
    }

    private void resolveGranted(PluginCall call, boolean granted) {
        JSObject r = new JSObject();
        r.put("granted", granted);
        call.resolve(r);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        Context c = getContext();
        Uri pkg = Uri.parse("package:" + c.getPackageName());
        Intent i;
        switch (call.getString("kind", "app")) {
            case "overlay":
                i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, pkg);
                break;
            case "battery":
                i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, pkg);
                break;
            case "fullScreen":
                i = Build.VERSION.SDK_INT >= 34 ? new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, pkg) : new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg);
                break;
            case "exactAlarm":
                i = Build.VERSION.SDK_INT >= 31 ? new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, pkg) : new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg);
                break;
            case "notifications":
                i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, c.getPackageName());
                break;
            default:
                i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg);
        }
        startSettings(i);
        call.resolve();
    }

    private void startSettings(Intent i) {
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getActivity().startActivity(i);
        } catch (ActivityNotFoundException e) {
            Intent fallback = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
            getActivity().startActivity(fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        }
    }

    @PluginMethod
    public void startWakeWord(PluginCall call) {
        List<String> phrases = new ArrayList<>();
        JSONArray arr = call.getArray("phrases", new JSArray());
        for (int i = 0; i < arr.length(); i++) {
            String p = arr.optString(i, "").trim();
            if (!p.isEmpty()) phrases.add(p);
        }
        if (phrases.isEmpty()) phrases.addAll(JarvisPrefs.DEFAULT_PHRASES);
        Float threshold = call.getFloat("threshold", 0.55f);
        JarvisPrefs.saveWake(
            getContext(),
            phrases,
            call.getString("mode", "always"),
            threshold == null ? 0.55f : threshold,
            Boolean.TRUE.equals(call.getBoolean("allowOnLockScreen", false))
        );
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("Microphone permission is needed");
            return;
        }
        WakeWordService.reconfigure();
        try {
            ContextCompat.startForegroundService(getContext(), new Intent(getContext(), WakeWordService.class).setAction(WakeWordService.ACTION_START));
        } catch (Exception e) {
            call.reject("Could not start listening: " + e.getMessage());
            return;
        }
        call.resolve(wakeStatus());
    }

    @PluginMethod
    public void stopWakeWord(PluginCall call) {
        JarvisPrefs.setWakeEnabled(getContext(), false);
        if (WakeWordService.running) {
            try {
                getContext().startService(new Intent(getContext(), WakeWordService.class).setAction(WakeWordService.ACTION_STOP));
            } catch (Exception ignored) {}
        }
        call.resolve();
    }

    @PluginMethod
    public void pauseWakeWord(PluginCall call) {
        WakeWordService.pause();
        call.resolve();
    }

    @PluginMethod
    public void resumeWakeWord(PluginCall call) {
        WakeWordService.resume();
        call.resolve();
    }

    @PluginMethod
    public void listen(PluginCall call) {
        String lang = call.getString("language", "en-IN");
        getActivity().runOnUiThread(() -> speech.listen(call, lang));
    }

    @PluginMethod
    public void stopListening(PluginCall call) {
        getActivity().runOnUiThread(speech::stop);
        call.resolve();
    }

    @PluginMethod
    public void speak(PluginCall call) {
        Float rate = call.getFloat("rate", 1f);
        Float pitch = call.getFloat("pitch", 1f);
        tts.speak(call, call.getString("text", ""), call.getString("language", "en-IN"), rate == null ? 1f : rate, pitch == null ? 1f : pitch);
    }

    @PluginMethod
    public void stopSpeaking(PluginCall call) {
        tts.stop();
        call.resolve();
    }

    @PluginMethod
    public void setAlarms(PluginCall call) {
        int n = AlarmScheduler.replaceAll(getContext(), call.getArray("alarms", new JSArray()));
        JSObject r = new JSObject();
        r.put("scheduled", n);
        call.resolve(r);
    }

    @PluginMethod
    public void setSystemAlarm(PluginCall call) {
        Intent i = new Intent(AlarmClock.ACTION_SET_ALARM)
            .putExtra(AlarmClock.EXTRA_HOUR, (int) call.getInt("hour", 7))
            .putExtra(AlarmClock.EXTRA_MINUTES, (int) call.getInt("minute", 0))
            .putExtra(AlarmClock.EXTRA_MESSAGE, call.getString("message", "Jarvis"))
            .putExtra(AlarmClock.EXTRA_SKIP_UI, true);
        startClock(call, i);
    }

    @PluginMethod
    public void setSystemTimer(PluginCall call) {
        Intent i = new Intent(AlarmClock.ACTION_SET_TIMER)
            .putExtra(AlarmClock.EXTRA_LENGTH, (int) call.getInt("seconds", 60))
            .putExtra(AlarmClock.EXTRA_MESSAGE, call.getString("message", "Jarvis timer"))
            .putExtra(AlarmClock.EXTRA_SKIP_UI, true);
        startClock(call, i);
    }

    private void startClock(PluginCall call, Intent i) {
        try {
            getActivity().startActivity(i);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("No clock app found on this phone");
        }
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        try {
            getActivity().startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(call.getString("url", ""))).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open the link");
        }
    }

    @PluginMethod
    public void minimize(PluginCall call) {
        getActivity().runOnUiThread(() -> getActivity().moveTaskToBack(true));
        call.resolve();
    }
}
