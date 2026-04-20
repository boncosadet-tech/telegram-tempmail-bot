import 'package:flutter/services.dart';

class NativeActions {
  NativeActions._();

  static const MethodChannel _channel = MethodChannel('telegram_tempmail/native');

  static Future<void> openUrl(String url) async {
    if (url.trim().isEmpty) return;
    await _channel.invokeMethod<bool>('openUrl', <String, String>{'url': url});
  }

  static Future<void> copyText(String text) async {
    if (text.isEmpty) return;
    await _channel.invokeMethod<bool>('copyText', <String, String>{'text': text});
  }
}
