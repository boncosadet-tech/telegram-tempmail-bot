package id.shizukudes.telegram_tempmail

import android.app.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private val channelName = "telegram_tempmail/native"
    private lateinit var secureStore: SecureStore

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        secureStore = SecureStore(applicationContext)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, channelName).setMethodCallHandler { call, result ->
            try {
                when (call.method) {
                    "openUrl" -> {
                        openUrl(call.argument<String>("url") ?: "")
                        result.success(true)
                    }
                    "copyText" -> {
                        copyText(call.argument<String>("text") ?: "")
                        result.success(true)
                    }
                    "secureSave" -> {
                        val key = call.argument<String>("key") ?: ""
                        val value = call.argument<String>("value") ?: ""
                        secureStore.save(key, value)
                        result.success(true)
                    }
                    "secureRead" -> {
                        val key = call.argument<String>("key") ?: ""
                        result.success(secureStore.read(key))
                    }
                    "secureDelete" -> {
                        val key = call.argument<String>("key") ?: ""
                        secureStore.delete(key)
                        result.success(true)
                    }
                    "secureClear" -> {
                        secureStore.clear()
                        result.success(true)
                    }
                    else -> result.notImplemented()
                }
            } catch (error: IllegalArgumentException) {
                result.error("bad_request", error.message, null)
            } catch (error: ActivityNotFoundException) {
                result.error("activity_not_found", "No app can open this URL", null)
            } catch (error: Exception) {
                result.error("native_error", error.message, null)
            }
        }
    }

    private fun openUrl(url: String) {
        if (url.isBlank()) throw IllegalArgumentException("URL is empty")
        val uri = Uri.parse(url)
        val scheme = uri.scheme ?: throw IllegalArgumentException("URL scheme is missing")
        if (scheme != "http" && scheme != "https" && scheme != "tg") {
            throw IllegalArgumentException("Unsupported URL scheme")
        }
        startActivity(Intent(Intent.ACTION_VIEW, uri))
    }

    private fun copyText(text: String) {
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("TempMail", text))
    }
}
