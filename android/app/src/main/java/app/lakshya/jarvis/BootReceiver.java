package app.lakshya.jarvis;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Restores alerts after a reboot or app update, and offers to turn listening back on. */
public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context c, Intent intent) {
        String a = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(a) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)) return;
        AlarmScheduler.restoreAll(c);
        // Android doesn't let a microphone service start from the background after boot
        if (JarvisPrefs.wakeEnabled(c)) Notifs.showRestartPrompt(c);
    }
}
