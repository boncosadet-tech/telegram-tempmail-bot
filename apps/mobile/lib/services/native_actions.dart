import 'package:flutter/services.dart';

class NativeActions {
  NativeActions._();

  static const MethodChannel _channel =
      MethodChannel('telegram_tempmail/native');

  static Future<void> openUrl(String url) async {
    if (url.trim().isEmpty) return;
    await _channel.invokeMethod<bool>('openUrl', <String, String>{'url': url});
  }

  static Future<void> copyText(String text) async {
    if (text.isEmpty) return;
    await _channel
        .invokeMethod<bool>('copyText', <String, String>{'text': text});
  }
}

class NativeSecureStore {
  const NativeSecureStore();

  static const MethodChannel _channel =
      MethodChannel('telegram_tempmail/native');

  Future<void> save(String key, String value) async {
    if (key.trim().isEmpty) return;
    await _channel.invokeMethod<bool>(
        'secureSave', <String, String>{'key': key, 'value': value});
  }

  Future<String?> read(String key) async {
    if (key.trim().isEmpty) return null;
    return _channel
        .invokeMethod<String>('secureRead', <String, String>{'key': key});
  }

  Future<void> delete(String key) async {
    if (key.trim().isEmpty) return;
    await _channel
        .invokeMethod<bool>('secureDelete', <String, String>{'key': key});
  }

  Future<void> clear() async {
    await _channel.invokeMethod<bool>('secureClear');
  }
}
