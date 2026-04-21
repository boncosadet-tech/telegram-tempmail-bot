import 'dart:convert';

import '../core/models/setup_models.dart';
import 'native_actions.dart';

class SecureConfigStore {
  const SecureConfigStore({NativeSecureStore? nativeStore}) : _nativeStore = nativeStore ?? const NativeSecureStore();

  static const setupStateKey = 'setup_state';
  static const cloudflareEmailKey = 'cloudflare_email';
  static const cloudflareGlobalApiKeyKey = 'cloudflare_global_api_key';
  static const telegramBotTokenKey = 'telegram_bot_token';

  final NativeSecureStore _nativeStore;

  Future<void> saveSetupState(MobileSetupState state) async {
    await _nativeStore.save(setupStateKey, jsonEncode(state.toJson()));
  }

  Future<MobileSetupState?> readSetupState() async {
    final raw = await _nativeStore.read(setupStateKey);
    if (raw == null || raw.trim().isEmpty) return null;
    try {
      final data = jsonDecode(raw) as Map<String, dynamic>;
      final state = MobileSetupState.fromJson(data);
      if (state.primaryDomain.isEmpty || state.accountId.isEmpty || state.d1DatabaseId.isEmpty) return null;
      return state;
    } on Object {
      return null;
    }
  }

  Future<void> saveCredentials(SetupDraft draft) async {
    await _nativeStore.save(cloudflareEmailKey, draft.cloudflareEmail.trim());
    await _nativeStore.save(cloudflareGlobalApiKeyKey, draft.cloudflareGlobalApiKey.trim());
    await _nativeStore.save(telegramBotTokenKey, draft.telegramBotToken.trim());
  }

  Future<StoredCredentials?> readCredentials() async {
    final email = await _nativeStore.read(cloudflareEmailKey) ?? '';
    final globalKey = await _nativeStore.read(cloudflareGlobalApiKeyKey) ?? '';
    final botToken = await _nativeStore.read(telegramBotTokenKey) ?? '';
    final credentials = StoredCredentials(
      cloudflareEmail: email,
      cloudflareGlobalApiKey: globalKey,
      telegramBotToken: botToken,
    );
    return credentials.isComplete ? credentials : null;
  }

  Future<void> clearCredentials() async {
    await _nativeStore.delete(cloudflareEmailKey);
    await _nativeStore.delete(cloudflareGlobalApiKeyKey);
    await _nativeStore.delete(telegramBotTokenKey);
  }

  Future<void> clearAll() => _nativeStore.clear();
}
