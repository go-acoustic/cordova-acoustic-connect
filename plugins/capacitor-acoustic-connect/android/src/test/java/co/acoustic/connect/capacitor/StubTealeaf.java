package co.acoustic.connect.capacitor;

/** Stands in for com.tl.uic.Tealeaf: flushAll takes a boxed Boolean, as the SDK's does. */
public class StubTealeaf {

    public static Boolean lastFlushAll;

    public static void flushAll(Boolean unload) {
        lastFlushAll = unload;
    }
}
