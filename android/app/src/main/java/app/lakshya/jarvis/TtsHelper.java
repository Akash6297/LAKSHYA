package app.lakshya.jarvis;

import android.content.Context;
import android.media.AudioAttributes;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import com.getcapacitor.PluginCall;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/** Jarvis's voice: Android's built-in text-to-speech. Resolves each call when speaking ends. */
final class TtsHelper extends UtteranceProgressListener implements TextToSpeech.OnInitListener {

    private final Context ctx;
    private TextToSpeech tts;
    private volatile boolean initDone;
    private volatile boolean ready;
    private final List<Runnable> waiting = new ArrayList<>();
    private final Map<String, PluginCall> calls = new ConcurrentHashMap<>();

    TtsHelper(Context c) {
        ctx = c.getApplicationContext();
    }

    private synchronized void ensure() {
        if (tts != null) return;
        tts = new TextToSpeech(ctx, this);
        tts.setOnUtteranceProgressListener(this);
        tts.setAudioAttributes(
            new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()
        );
    }

    @Override
    public void onInit(int status) {
        List<Runnable> jobs;
        synchronized (this) {
            initDone = true;
            ready = status == TextToSpeech.SUCCESS;
            jobs = new ArrayList<>(waiting);
            waiting.clear();
        }
        for (Runnable r : jobs) r.run();
    }

    void speak(PluginCall call, String text, String language, float rate, float pitch) {
        Runnable job = () -> {
            if (!ready || text == null || text.trim().isEmpty()) {
                call.resolve();
                return;
            }
            boolean devanagari = text.matches("(?s).*[\\u0900-\\u097F].*");
            Locale want = Locale.forLanguageTag(devanagari ? "hi-IN" : language);
            int res = tts.setLanguage(want);
            if (res == TextToSpeech.LANG_MISSING_DATA || res == TextToSpeech.LANG_NOT_SUPPORTED) {
                if (tts.setLanguage(new Locale("en", "IN")) < 0) tts.setLanguage(Locale.US);
            }
            tts.setSpeechRate(rate);
            tts.setPitch(pitch);
            String id = UUID.randomUUID().toString();
            calls.put(id, call);
            if (tts.speak(text, TextToSpeech.QUEUE_FLUSH, new Bundle(), id) != TextToSpeech.SUCCESS) {
                calls.remove(id);
                call.resolve();
            }
        };
        synchronized (this) {
            ensure();
            if (!initDone) {
                waiting.add(job);
                return;
            }
        }
        job.run();
    }

    void stop() {
        if (tts != null) tts.stop();
        for (PluginCall c : calls.values()) c.resolve();
        calls.clear();
    }

    void shutdown() {
        stop();
        if (tts != null) tts.shutdown();
    }

    private void done(String id) {
        PluginCall c = calls.remove(id);
        if (c != null) c.resolve();
    }

    @Override
    public void onStart(String utteranceId) {}

    @Override
    public void onDone(String utteranceId) {
        done(utteranceId);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onError(String utteranceId) {
        done(utteranceId);
    }

    @Override
    public void onError(String utteranceId, int errorCode) {
        done(utteranceId);
    }

    @Override
    public void onStop(String utteranceId, boolean interrupted) {
        done(utteranceId);
    }
}
