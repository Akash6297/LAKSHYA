package app.lakshya.jarvis;

import android.content.Context;
import android.content.Intent;
import android.graphics.PixelFormat;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;

/** Brings Jarvis to the front after the wake word, within Android's background-launch rules. */
final class WakeLauncher {

    private WakeLauncher() {}

    static void launch(Context ctx, String phrase) {
        // already on screen: just tell the web app
        if (MainActivity.isVisible()) {
            JarvisPlugin.deliver(LaunchInfo.wake(phrase, false));
            return;
        }
        Intent i = new Intent(ctx, MainActivity.class)
            .setAction(MainActivity.ACTION_WAKE)
            .putExtra(MainActivity.EXTRA_PHRASE, phrase)
            .putExtra(MainActivity.EXTRA_FROM_BACKGROUND, true)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);

        Handler main = new Handler(Looper.getMainLooper());
        if (Settings.canDrawOverlays(ctx)) {
            // Android 15+: apps holding "Display over other apps" may start an activity
            // from the background only while one of their overlay windows is visible.
            View overlay = addOverlay(ctx);
            try {
                ctx.startActivity(i);
            } catch (Exception ignored) {}
            main.postDelayed(() -> removeOverlay(ctx, overlay), 2500);
        }
        // If Android still blocked the launch, fall back to a full-screen notification:
        // it opens Jarvis directly when the screen is off/locked, and is one tap otherwise.
        main.postDelayed(
            () -> {
                if (!MainActivity.isVisible()) Notifs.showWakePrompt(ctx, i);
            },
            Settings.canDrawOverlays(ctx) ? 1800 : 0
        );
    }

    private static View addOverlay(Context ctx) {
        try {
            WindowManager wm = ctx.getSystemService(WindowManager.class);
            if (wm == null) return null;
            View v = new View(ctx);
            int type = Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE;
            WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                1,
                1,
                type,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT
            );
            lp.gravity = Gravity.TOP | Gravity.START;
            wm.addView(v, lp);
            return v;
        } catch (Exception e) {
            return null;
        }
    }

    private static void removeOverlay(Context ctx, View v) {
        if (v == null) return;
        try {
            WindowManager wm = ctx.getSystemService(WindowManager.class);
            if (wm != null) wm.removeView(v);
        } catch (Exception ignored) {}
    }
}
