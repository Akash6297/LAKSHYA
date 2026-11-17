package app.lakshya.jarvis;

import android.app.KeyguardManager;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    static final String ACTION_WAKE = "app.lakshya.jarvis.action.WAKE";
    static final String ACTION_OPEN = "app.lakshya.jarvis.action.OPEN";
    static final String EXTRA_PHRASE = "phrase";
    static final String EXTRA_FROM_BACKGROUND = "fromBackground";
    static final String EXTRA_ROUTE = "route";

    private static volatile boolean visible;

    static boolean isVisible() {
        return visible;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(JarvisPlugin.class);
        super.onCreate(savedInstanceState);
        handle(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handle(intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        visible = true;
        Notifs.cancelWakePrompt(this);
    }

    @Override
    public void onPause() {
        super.onPause();
        visible = false;
    }

    @Override
    public void onStop() {
        super.onStop();
        // the lock-screen pass is only for the wake-word session
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(false);
            setTurnScreenOn(false);
        } else {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
    }

    private void handle(Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        String action = intent.getAction();
        if (ACTION_WAKE.equals(action)) {
            showOverLockScreen();
            JarvisPlugin.deliver(LaunchInfo.wake(intent.getStringExtra(EXTRA_PHRASE), intent.getBooleanExtra(EXTRA_FROM_BACKGROUND, true)));
            intent.setAction(Intent.ACTION_MAIN); // don't replay after rotation / recreation
        } else if (ACTION_OPEN.equals(action)) {
            JarvisPlugin.deliver(LaunchInfo.open(intent.getStringExtra(EXTRA_ROUTE)));
            intent.setAction(Intent.ACTION_MAIN);
        }
    }

    private void showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        KeyguardManager km = getSystemService(KeyguardManager.class);
        if (km != null && km.isKeyguardLocked() && !JarvisPrefs.allowOnLockScreen(this) && Build.VERSION.SDK_INT >= 26) {
            // ask for fingerprint / PIN; the web app waits for "unlocked" before reading anything private
            km.requestDismissKeyguard(this, null);
        }
    }
}
