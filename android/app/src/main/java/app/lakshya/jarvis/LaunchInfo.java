package app.lakshya.jarvis;

import com.getcapacitor.JSObject;

/** Why the app was brought to the front: the wake word, or a notification tap with a route. */
final class LaunchInfo {

    final String action;
    final String phrase;
    final String route;
    final boolean fromBackground;

    private LaunchInfo(String action, String phrase, String route, boolean fromBackground) {
        this.action = action;
        this.phrase = phrase;
        this.route = route;
        this.fromBackground = fromBackground;
    }

    static LaunchInfo wake(String phrase, boolean fromBackground) {
        return new LaunchInfo("wake", phrase == null ? "" : phrase, null, fromBackground);
    }

    static LaunchInfo open(String route) {
        return new LaunchInfo("open", null, route, false);
    }

    boolean isWake() {
        return "wake".equals(action);
    }

    JSObject toJS() {
        JSObject o = new JSObject();
        o.put("action", action);
        if (phrase != null) o.put("phrase", phrase);
        if (route != null) o.put("route", route);
        o.put("fromBackground", fromBackground);
        return o;
    }
}
