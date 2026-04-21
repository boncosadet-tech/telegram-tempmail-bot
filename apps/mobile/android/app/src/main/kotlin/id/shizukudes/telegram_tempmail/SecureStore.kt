package id.shizukudes.telegram_tempmail

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class SecureStore(context: Context) {
    private val prefs = context.getSharedPreferences("telegram_tempmail_secure_store", Context.MODE_PRIVATE)
    private val alias = "telegram_tempmail_secure_store_key"
    private val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    fun save(key: String, value: String) {
        require(key.isNotBlank()) { "Storage key is empty" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val cipherText = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        val payload = base64(cipher.iv) + ":" + base64(cipherText)
        prefs.edit().putString(key, payload).apply()
    }

    fun read(key: String): String? {
        require(key.isNotBlank()) { "Storage key is empty" }
        val payload = prefs.getString(key, null) ?: return null
        val parts = payload.split(":", limit = 2)
        if (parts.size != 2) return null
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(128, unbase64(parts[0])))
        val plain = cipher.doFinal(unbase64(parts[1]))
        return String(plain, Charsets.UTF_8)
    }

    fun delete(key: String) {
        require(key.isNotBlank()) { "Storage key is empty" }
        prefs.edit().remove(key).apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    private fun getOrCreateKey(): SecretKey {
        val existing = keyStore.getEntry(alias, null) as? KeyStore.SecretKeyEntry
        if (existing != null) return existing.secretKey
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        val spec = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build()
        generator.init(spec)
        return generator.generateKey()
    }

    private fun base64(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)

    private fun unbase64(value: String): ByteArray = Base64.decode(value, Base64.NO_WRAP)
}
