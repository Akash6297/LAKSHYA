package app.lakshya.jarvis;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;
import org.vosk.LibVosk;
import org.vosk.LogLevel;
import org.vosk.Model;
import org.vosk.Recognizer;
import org.vosk.android.StorageService;

/**
 * Always-on wake word. A foreground service (Android shows a small notification
 * and the green mic dot) reads the microphone in 100 ms chunks, skips silence
 * cheaply, and runs the offline Vosk recogniser restricted to the wake phrases.
 * Nothing leaves the phone. On a match it frees the mic and opens Jarvis.
 */
public class WakeWordService extends Service {

    static final String ACTION_START = "app.lakshya.jarvis.action.WAKE_START";
    static final String ACTION_STOP = "app.lakshya.jarvis.action.WAKE_STOP";
    static final String ACTION_SNOOZE = "app.lakshya.jarvis.action.WAKE_SNOOZE";

    private static final int NOTIFICATION_ID = 4101;
    private static final int SAMPLE_RATE = 16000;
    private static final int CHUNK = 1600; // 100 ms of 16 kHz mono
    private static final String MODEL_ASSET = "model-en-in";

    // read by JarvisPlugin.getStatus (same process)
    static volatile boolean running;
    static volatile boolean paused;
    static volatile boolean listening;
    static volatile boolean modelReady;
    static volatile String error;
    static volatile String[] unknownWords = new String[0];
    private static volatile WakeWordService instance;

    private volatile long pausedUntil;
    private volatile long autoResumeAt;
    private volatile boolean configChanged = true;
    private volatile boolean screenOn = true;
    private volatile boolean charging;
    private volatile Model model;
    private volatile boolean modelLoading;
    private Thread worker;
    private PowerManager.WakeLock wakeLock;
    private final Map<String, String> grammarToPhrase = new LinkedHashMap<>();
    private final Handler main = new Handler(Looper.getMainLooper());

    private final BroadcastReceiver stateReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent i) {
            String a = i.getAction();
            if (Intent.ACTION_SCREEN_ON.equals(a)) screenOn = true;
            else if (Intent.ACTION_SCREEN_OFF.equals(a)) screenOn = false;
            else if (Intent.ACTION_POWER_CONNECTED.equals(a)) charging = true;
            else if (Intent.ACTION_POWER_DISCONNECTED.equals(a)) charging = false;
            else if (Intent.ACTION_USER_PRESENT.equals(a)) JarvisPlugin.emitUnlocked();
        }
    };

    /** Called while Jarvis is talking so the speech recogniser can use the mic (and Jarvis can't wake itself). */
    static void pause() {
        paused = true;
        WakeWordService s = instance;
        if (s != null) s.autoResumeAt = System.currentTimeMillis() + 3 * 60_000;
    }

    static void resume() {
        paused = false;
        WakeWordService s = instance;
        if (s != null) s.autoResumeAt = 0;
    }

    static void reconfigure() {
        WakeWordService s = instance;
        if (s != null) s.configChanged = true;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        Notifs.ensureChannels(this);
        IntentFilter f = new IntentFilter();
        f.addAction(Intent.ACTION_SCREEN_ON);
        f.addAction(Intent.ACTION_SCREEN_OFF);
        f.addAction(Intent.ACTION_POWER_CONNECTED);
        f.addAction(Intent.ACTION_POWER_DISCONNECTED);
        f.addAction(Intent.ACTION_USER_PRESENT);
        ContextCompat.registerReceiver(this, stateReceiver, f, ContextCompat.RECEIVER_NOT_EXPORTED);
        PowerManager pm = getSystemService(PowerManager.class);
        screenOn = pm == null || pm.isInteractive();
        Intent battery = registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        charging = battery != null && battery.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0;
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "LakshyaJarvis:wake");
            wakeLock.setReferenceCounted(false);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_START : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            JarvisPrefs.setWakeEnabled(this, false);
            shutdown();
            return START_NOT_STICKY;
        }
        if (ACTION_SNOOZE.equals(action)) pausedUntil = System.currentTimeMillis() + 60 * 60_000L;
        else pausedUntil = 0;
        if (!goForeground()) {
            shutdown();
            return START_NOT_STICKY;
        }
        running = true;
        error = null;
        configChanged = true;
        ensureModel();
        ensureWorker();
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        running = false;
        listening = false;
        instance = null;
        try {
            unregisterReceiver(stateReceiver);
        } catch (Exception ignored) {}
        releaseWakeLock();
        super.onDestroy();
    }

    private void shutdown() {
        running = false;
        listening = false;
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private boolean goForeground() {
        try {
            int type = Build.VERSION.SDK_INT >= 30 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE : 0;
            ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), type);
            return true;
        } catch (Exception e) {
            error = "Android did not allow listening in the background. Open the app once to turn it back on.";
            return false;
        }
    }

    private Notification buildNotification() {
        boolean snoozed = System.currentTimeMillis() < pausedUntil;
        int flags = PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT;
        PendingIntent open = Notifs.openApp(this, null, 10);
        PendingIntent toggle = PendingIntent.getService(this, 11, new Intent(this, WakeWordService.class).setAction(snoozed ? ACTION_START : ACTION_SNOOZE), flags);
        PendingIntent stop = PendingIntent.getService(this, 12, new Intent(this, WakeWordService.class).setAction(ACTION_STOP), flags);
        return new NotificationCompat.Builder(this, Notifs.CH_LISTEN)
            .setSmallIcon(R.drawable.ic_stat_jarvis)
            .setContentTitle(snoozed ? "Jarvis is paused for an hour" : "Jarvis is listening")
            .setContentText(snoozed ? "Tap Resume to listen again" : "Say “Hey Jarvis” or “Radhe Radhe Jarvis”")
            .setOngoing(true)
            .setSilent(true)
            .setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setContentIntent(open)
            .addAction(0, snoozed ? "Resume" : "Pause 1 hour", toggle)
            .addAction(0, "Turn off", stop)
            .build();
    }

    private void ensureModel() {
        if (model != null || modelLoading) return;
        modelLoading = true;
        new Thread(
            () -> {
                try {
                    // copies the model out of the APK once (re-copied only when its uuid changes)
                    String path = StorageService.sync(getApplicationContext(), MODEL_ASSET, "model");
                    LibVosk.setLogLevel(LogLevel.WARNINGS);
                    Vocab.load(path);
                    model = new Model(path);
                    modelReady = true;
                    configChanged = true;
                } catch (Throwable t) {
                    error = "The offline voice model could not load: " + t.getMessage();
                } finally {
                    modelLoading = false;
                }
            },
            "jarvis-model"
        ).start();
    }

    private void ensureWorker() {
        if (worker != null && worker.isAlive()) return;
        worker = new Thread(this::loop, "jarvis-wake");
        worker.start();
    }

    private boolean shouldListen() {
        if (!running || paused || System.currentTimeMillis() < pausedUntil) return false;
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            error = "Microphone permission is off.";
            return false;
        }
        switch (JarvisPrefs.mode(this)) {
            case "screen_on":
                return screenOn;
            case "charging":
                return charging;
            default:
                return true;
        }
    }

    private void loop() {
        AudioRecord rec = null;
        Recognizer recognizer = null;
        short[] buf = new short[CHUNK];
        ArrayDeque<short[]> preroll = new ArrayDeque<>();
        double noise = 200; // running background level (RMS of 16-bit samples)
        int hangover = 0;
        boolean gateOpen = false;
        boolean wasSnoozed = false;
        try {
            while (running) {
                if (paused && autoResumeAt > 0 && System.currentTimeMillis() > autoResumeAt) resume();
                boolean snoozed = System.currentTimeMillis() < pausedUntil;
                if (snoozed != wasSnoozed) {
                    wasSnoozed = snoozed;
                    main.post(this::refreshNotification);
                }
                boolean want = shouldListen();
                if (!want || model == null) {
                    if (rec != null) {
                        stopRecording(rec);
                        rec = null;
                    }
                    if (recognizer != null && gateOpen) recognizer.reset();
                    listening = false;
                    gateOpen = false;
                    hangover = 0;
                    preroll.clear();
                    releaseWakeLock();
                    sleep(300);
                    continue;
                }
                if (configChanged || recognizer == null) {
                    configChanged = false;
                    if (recognizer != null) recognizer.close();
                    recognizer = createRecognizer();
                    if (recognizer == null) {
                        sleep(2000);
                        continue;
                    }
                }
                if (rec == null) {
                    rec = startRecording();
                    if (rec == null) {
                        // mic busy (phone call, another app recording): try again shortly
                        listening = false;
                        sleep(2000);
                        continue;
                    }
                    acquireWakeLock();
                }
                listening = true;
                int n = rec.read(buf, 0, CHUNK);
                if (n <= 0) {
                    stopRecording(rec);
                    rec = null;
                    sleep(500);
                    continue;
                }
                double rms = rms(buf, n);
                boolean loud = rms > Math.max(noise * 1.8, 120);
                if (!loud && !gateOpen) noise = noise * 0.95 + rms * 0.05;
                short[] chunk = Arrays.copyOf(buf, n);
                if (loud) {
                    if (!gateOpen) {
                        gateOpen = true;
                        for (short[] p : preroll) recognizer.acceptWaveForm(p, p.length);
                        preroll.clear();
                    }
                    hangover = 12; // keep decoding ~1.2 s after the last loud chunk
                }
                if (gateOpen) {
                    if (recognizer.acceptWaveForm(chunk, n)) check(recognizer.getResult());
                    if (!loud && --hangover <= 0) {
                        gateOpen = false;
                        check(recognizer.getFinalResult());
                        recognizer.reset();
                    }
                } else {
                    preroll.addLast(chunk);
                    while (preroll.size() > 6) preroll.removeFirst();
                }
            }
        } catch (Throwable t) {
            error = "The listener stopped: " + t.getMessage();
        } finally {
            if (rec != null) stopRecording(rec);
            if (recognizer != null) recognizer.close();
            listening = false;
            releaseWakeLock();
        }
    }

    private Recognizer createRecognizer() {
        grammarToPhrase.clear();
        Set<String> vocab = Vocab.words();
        List<String> missing = new ArrayList<>();
        JSONArray grammar = new JSONArray();
        for (String phrase : JarvisPrefs.phrases(this)) {
            String spelled = Vocab.spell(phrase);
            if (spelled.isEmpty()) continue;
            boolean ok = true;
            if (vocab != null) {
                for (String w : spelled.split(" ")) {
                    if (!vocab.contains(w)) {
                        ok = false;
                        if (!missing.contains(w)) missing.add(w);
                    }
                }
            }
            if (ok && !grammarToPhrase.containsKey(spelled)) {
                grammarToPhrase.put(spelled, phrase);
                grammar.put(spelled);
            }
        }
        unknownWords = missing.toArray(new String[0]);
        if (grammar.length() == 0) {
            error = "None of the wake phrases can be recognised offline. Try “hey jarvis”.";
            return null;
        }
        grammar.put("[unk]"); // everything else
        try {
            Recognizer r = new Recognizer(model, SAMPLE_RATE, grammar.toString());
            r.setWords(true);
            r.setEndpointerDelays(3f, 0.35f, 5f);
            error = null;
            return r;
        } catch (Exception e) {
            error = "Could not start the recogniser: " + e.getMessage();
            return null;
        }
    }

    /** Vosk result JSON → wake phrase whose words were heard confidently enough. */
    private void check(String json) {
        if (json == null || paused) return;
        try {
            JSONObject o = new JSONObject(json);
            String text = o.optString("text", "").trim();
            if (text.isEmpty()) return;
            String[] toks = text.split("\\s+");
            JSONArray words = o.optJSONArray("result");
            float threshold = JarvisPrefs.threshold(this);
            for (Map.Entry<String, String> e : grammarToPhrase.entrySet()) {
                String[] p = e.getKey().split(" ");
                int at = indexOf(toks, p);
                if (at < 0) continue;
                double conf = 1;
                if (words != null && words.length() == toks.length) {
                    double sum = 0;
                    for (int i = 0; i < p.length; i++) sum += words.getJSONObject(at + i).optDouble("conf", 1);
                    conf = sum / p.length;
                }
                if (conf >= threshold) {
                    onWake(e.getValue());
                    return;
                }
            }
        } catch (Exception ignored) {}
    }

    private static int indexOf(String[] hay, String[] needle) {
        outer:
        for (int i = 0; i + needle.length <= hay.length; i++) {
            for (int j = 0; j < needle.length; j++) if (!hay[i + j].equals(needle[j])) continue outer;
            return i;
        }
        return -1;
    }

    private void onWake(String phrase) {
        pause(); // frees the microphone on the next loop iteration
        vibrate();
        main.post(() -> WakeLauncher.launch(getApplicationContext(), phrase));
    }

    private void refreshNotification() {
        try {
            int type = Build.VERSION.SDK_INT >= 30 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE : 0;
            ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), type);
        } catch (Exception ignored) {}
    }

    @SuppressLint("MissingPermission")
    private AudioRecord startRecording() {
        try {
            int min = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            AudioRecord r = new AudioRecord(
                MediaRecorder.AudioSource.VOICE_RECOGNITION,
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                Math.max(min, CHUNK * 2 * 4)
            );
            if (r.getState() != AudioRecord.STATE_INITIALIZED) {
                r.release();
                return null;
            }
            r.startRecording();
            if (r.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) {
                r.release();
                return null;
            }
            return r;
        } catch (Exception e) {
            return null;
        }
    }

    private static void stopRecording(AudioRecord r) {
        try {
            r.stop();
        } catch (Exception ignored) {}
        r.release();
    }

    private static double rms(short[] b, int n) {
        double sum = 0;
        for (int i = 0; i < n; i++) sum += (double) b[i] * b[i];
        return Math.sqrt(sum / Math.max(1, n));
    }

    @SuppressLint("WakelockTimeout")
    private void acquireWakeLock() {
        if (wakeLock != null && !wakeLock.isHeld()) wakeLock.acquire();
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
    }

    private void vibrate() {
        try {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v == null) return;
            if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createOneShot(60, VibrationEffect.DEFAULT_AMPLITUDE));
            else v.vibrate(60);
        } catch (Exception ignored) {}
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
    }
}
