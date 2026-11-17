package app.lakshya.jarvis;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.SystemClock;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.util.ArrayList;

/**
 * One command after the wake word, with Android's built-in speech recogniser
 * (free; uses the phone's speech service, offline if the language pack is installed).
 * Must be used on the main thread.
 */
final class SpeechHelper implements RecognitionListener {

    private final JarvisPlugin plugin;
    private SpeechRecognizer recognizer;
    private PluginCall call;
    private String lastPartial = "";
    private long lastLevelAt;

    SpeechHelper(JarvisPlugin plugin) {
        this.plugin = plugin;
    }

    void listen(PluginCall c, String language) {
        Context ctx = plugin.getContext();
        if (!SpeechRecognizer.isRecognitionAvailable(ctx)) {
            JSObject r = new JSObject();
            r.put("text", "");
            r.put("alternatives", new JSArray());
            r.put("error", "Speech recognition isn't available. Install or update the Google app.");
            c.resolve(r);
            return;
        }
        finish(null, null); // end any earlier session
        call = c;
        lastPartial = "";
        if (recognizer == null) {
            recognizer = SpeechRecognizer.createSpeechRecognizer(ctx);
            recognizer.setRecognitionListener(this);
        }
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, language)
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
            .putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, ctx.getPackageName())
            .putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1500L);
        try {
            recognizer.startListening(i);
        } catch (Exception e) {
            finish(null, "Could not start listening: " + e.getMessage());
        }
    }

    void stop() {
        if (recognizer != null) recognizer.stopListening();
    }

    void destroy() {
        finish(null, null);
        if (recognizer != null) {
            recognizer.destroy();
            recognizer = null;
        }
    }

    private void finish(ArrayList<String> results, String error) {
        PluginCall c = call;
        call = null;
        if (c == null) return;
        String text = results != null && !results.isEmpty() ? results.get(0) : (error == null ? lastPartial : "");
        JSObject r = new JSObject();
        r.put("text", text == null ? "" : text);
        JSArray alts = new JSArray();
        if (results != null) for (String s : results) alts.put(s);
        r.put("alternatives", alts);
        if (error != null) r.put("error", error);
        c.resolve(r);
    }

    @Override
    public void onReadyForSpeech(Bundle params) {}

    @Override
    public void onBeginningOfSpeech() {}

    @Override
    public void onRmsChanged(float rmsdB) {
        long now = SystemClock.uptimeMillis();
        if (now - lastLevelAt < 80) return;
        lastLevelAt = now;
        JSObject o = new JSObject();
        o.put("rms", rmsdB);
        plugin.emit("level", o);
    }

    @Override
    public void onBufferReceived(byte[] buffer) {}

    @Override
    public void onEndOfSpeech() {}

    @Override
    public void onError(int code) {
        switch (code) {
            case SpeechRecognizer.ERROR_NO_MATCH:
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
            case SpeechRecognizer.ERROR_CLIENT:
                finish(null, null);
                break;
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                finish(null, "Jarvis needs microphone permission. Turn it on in Settings → Jarvis.");
                break;
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
            case SpeechRecognizer.ERROR_SERVER:
                finish(null, "No internet for speech recognition. You can type instead, or download offline speech for your language in the Google app.");
                break;
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                if (recognizer != null) recognizer.cancel();
                finish(null, "The microphone is busy. Try again in a moment.");
                break;
            default:
                finish(null, "Speech recognition error " + code + ". Try again.");
        }
    }

    @Override
    public void onResults(Bundle results) {
        finish(results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION), null);
    }

    @Override
    public void onPartialResults(Bundle partial) {
        ArrayList<String> r = partial.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (r == null || r.isEmpty() || r.get(0) == null || r.get(0).isEmpty()) return;
        lastPartial = r.get(0);
        JSObject o = new JSObject();
        o.put("text", lastPartial);
        plugin.emit("partial", o);
    }

    @Override
    public void onEvent(int eventType, Bundle params) {}
}
