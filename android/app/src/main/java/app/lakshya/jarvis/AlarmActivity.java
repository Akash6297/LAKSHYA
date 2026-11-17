package app.lakshya.jarvis;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.text.format.DateFormat;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.core.app.NotificationManagerCompat;
import java.util.Date;
import java.util.Locale;
import org.json.JSONObject;

/** Full-screen "incoming call" style alert for meetings, exams, deadlines and urgent reminders. */
public class AlarmActivity extends Activity {

    private JSONObject alarm;
    private TextToSpeech tts;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        try {
            alarm = new JSONObject(getIntent().getStringExtra(AlarmReceiver.EXTRA_ALARM));
        } catch (Exception e) {
            finish();
            return;
        }
        setContentView(buildView());
        announce();
    }

    @Override
    protected void onDestroy() {
        if (tts != null) tts.shutdown();
        super.onDestroy();
    }

    private int dp(float v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
    }

    private View buildView() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setPadding(dp(28), dp(72), dp(28), dp(40));
        root.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, new int[] { Color.parseColor("#312E81"), Color.parseColor("#0B1020") }));

        TextView brand = text("JARVIS", 13, "#A5B4FC", true);
        brand.setLetterSpacing(0.3f);
        root.addView(brand);

        TextView clock = text(DateFormat.getTimeFormat(this).format(new Date()), 54, "#FFFFFF", true);
        clock.setPadding(0, dp(28), 0, 0);
        root.addView(clock);

        TextView title = text(alarm.optString("title", "Reminder"), 26, "#FFFFFF", true);
        title.setPadding(0, dp(24), 0, dp(8));
        root.addView(title);
        root.addView(text(alarm.optString("body", ""), 17, "#C7D2FE", false));

        View spacer = new View(this);
        root.addView(spacer, new LinearLayout.LayoutParams(1, 0, 1f));

        String url = alarm.optString("url", "");
        if (!url.isEmpty()) root.addView(button("Join now", "#22C55E", "#052E16", v -> join(url)));
        root.addView(button("Snooze 5 minutes", "#312E81", "#E0E7FF", v -> snooze()));
        root.addView(button("Open LAKSHYA", "#1E1B4B", "#E0E7FF", v -> open()));
        root.addView(button("Dismiss", "#F43F5E", "#FFFFFF", v -> dismiss()));
        return root;
    }

    private TextView text(String s, float sp, String color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(Color.parseColor(color));
        t.setGravity(Gravity.CENTER);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private Button button(String label, String bg, String fg, View.OnClickListener onClick) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        b.setTextColor(Color.parseColor(fg));
        b.setTypeface(Typeface.DEFAULT_BOLD);
        GradientDrawable d = new GradientDrawable();
        d.setColor(Color.parseColor(bg));
        d.setCornerRadius(dp(18));
        b.setBackground(d);
        b.setOnClickListener(onClick);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(58));
        lp.topMargin = dp(12);
        b.setLayoutParams(lp);
        return b;
    }

    private void announce() {
        String say = alarm.optString("title", "Reminder") + ". " + alarm.optString("body", "");
        tts = new TextToSpeech(this, status -> {
            if (status != TextToSpeech.SUCCESS) return;
            if (tts.setLanguage(new Locale("en", "IN")) < 0) tts.setLanguage(Locale.US);
            tts.speak(say, TextToSpeech.QUEUE_FLUSH, null, "jarvis-alarm");
        });
    }

    private void stopRinging() {
        NotificationManagerCompat.from(this).cancel(Notifs.idFor(alarm.optString("id")));
        if (tts != null) tts.stop();
    }

    private void dismiss() {
        stopRinging();
        finish();
    }

    private void snooze() {
        stopRinging();
        AlarmReceiver.snooze(this, alarm.toString(), alarm.optString("id"));
        finish();
    }

    private void join(String url) {
        stopRinging();
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (Exception ignored) {}
        finish();
    }

    private void open() {
        stopRinging();
        Intent i = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        String route = alarm.optString("route", "");
        if (!route.isEmpty()) i.setAction(MainActivity.ACTION_OPEN).putExtra(MainActivity.EXTRA_ROUTE, route);
        startActivity(i);
        finish();
    }
}
