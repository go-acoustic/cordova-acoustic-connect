# The plugin finds the Connect SDK's plugin-only web capture functions by reflection (WebEventLogger.kt), so an
# app that minifies keeps them: R8 removes a member nothing calls directly. An SDK without them (older than
# 11.1.39-beta) builds as before.
-keepclassmembers class com.acoustic.connect.android.connectmod.Connect {
    public boolean logWebClick(...);
    public boolean logWebGesture(...);
}
-keep class com.acoustic.connect.android.connectmod.model.ConnectWebTarget { public <init>(...); }
-dontwarn com.acoustic.connect.android.connectmod.model.ConnectWebTarget
