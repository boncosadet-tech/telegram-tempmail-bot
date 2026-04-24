# Flutter-safe R8/ProGuard rules for release builds.
# Shrinks the app while keeping Flutter and plugin channels working.

# Keep Flutter engine glue.
-keep class io.flutter.app.** { *; }
-keep class io.flutter.plugin.**  { *; }
-keep class io.flutter.util.**  { *; }
-keep class io.flutter.view.**  { *; }
-keep class io.flutter.**  { *; }
-keep class io.flutter.plugins.**  { *; }

# Keep anything that uses JSR305 / androidx annotations.
-keepattributes *Annotation*,Signature,EnclosingMethod,InnerClasses,Exceptions,SourceFile,LineNumberTable

# Kotlin metadata (helps reflection in some plugins).
-keep class kotlin.Metadata { *; }

# Silence warnings for missing Play Core classes (only pulled in for split install).
-dontwarn com.google.android.play.core.**

# Keep entry points used by platform channels.
-keepclassmembers class * {
    @io.flutter.embedding.engine.plugins.FlutterPlugin *;
}
