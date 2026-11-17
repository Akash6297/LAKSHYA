package app.lakshya.jarvis;

import java.io.File;
import java.io.RandomAccessFile;
import java.nio.ByteOrder;
import java.nio.MappedByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Wake-phrase spelling for the offline Vosk model. The model only knows its own
 * vocabulary (English words + some Indian names), so Hindi words are spelled the
 * way they sound with words it knows, and unknown words are reported to the app.
 */
final class Vocab {

    private static final int SYMBOL_TABLE_MAGIC = 2125658996;
    private static volatile Set<String> words;

    private Vocab() {}

    /** Words of the model's grammar (null when they could not be read; checks are then skipped). */
    static Set<String> words() {
        return words;
    }

    /** Reads the word symbol table embedded at the start of graph/Gr.fst (OpenFst format). */
    static void load(String modelPath) {
        File f = new File(modelPath, "graph/Gr.fst");
        if (!f.exists()) return;
        try (RandomAccessFile raf = new RandomAccessFile(f, "r"); FileChannel ch = raf.getChannel()) {
            MappedByteBuffer b = ch.map(FileChannel.MapMode.READ_ONLY, 0, ch.size());
            b.order(ByteOrder.LITTLE_ENDIAN);
            int off = -1;
            for (int i = 0; i < Math.min(4096, b.limit() - 4); i++) {
                if (b.getInt(i) == SYMBOL_TABLE_MAGIC) {
                    off = i;
                    break;
                }
            }
            if (off < 0) return;
            b.position(off + 4);
            int nameLen = b.getInt();
            b.position(b.position() + nameLen);
            b.getLong(); // available key
            long size = b.getLong();
            if (size <= 0 || size > 2_000_000) return;
            Set<String> set = new HashSet<>((int) (size * 2));
            byte[] tmp = new byte[512];
            for (long i = 0; i < size; i++) {
                int len = b.getInt();
                if (len < 0 || len > tmp.length) return;
                b.get(tmp, 0, len);
                set.add(new String(tmp, 0, len, StandardCharsets.UTF_8));
                b.getLong(); // key
            }
            words = set;
        } catch (Exception ignored) {
            // unknown layout: phrases are used as-is
        }
    }

    /** "radhe radhe lakshya" → "radha radha luck shia" (words the English model knows). */
    static String spell(String phrase) {
        String p = phrase.toLowerCase(Locale.ROOT).replaceAll("[^a-z' ]", " ").replaceAll("\\s+", " ").trim();
        p = p.replaceAll("\\b(?:radhe|radhey|raadhe|radhay)\\b", "radha");
        p = p.replaceAll("\\b(?:lakshya|lakshay|lakshaya|laksh|lakshyaa)\\b", "luck shia");
        p = p.replaceAll("\\b(?:jarvish|jarviss)\\b", "jarvis");
        p = p.replaceAll("\\bokay\\b", "okay");
        return p;
    }
}
