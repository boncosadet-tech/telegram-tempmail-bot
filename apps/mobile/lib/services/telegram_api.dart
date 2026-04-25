import 'dart:convert';
import 'dart:io';

class TelegramApi {
  static const Duration _networkTimeout = Duration(seconds: 45);
  TelegramApi(this.botToken);

  final String botToken;

  Future<Map<String, dynamic>> getMe() async {
    return _request('getMe');
  }

  Future<Map<String, dynamic>> getWebhookInfo() async {
    return _request('getWebhookInfo');
  }

  Future<Map<String, dynamic>> setWebhook({
    required String url,
    required String secretToken,
  }) async {
    return _request('setWebhook', <String, dynamic>{
      'url': url,
      'secret_token': secretToken,
      'allowed_updates': <String>[
        'message',
        'edited_message',
        'callback_query'
      ],
      'drop_pending_updates': false,
    });
  }

  Future<Map<String, dynamic>> _request(String method,
      [Map<String, dynamic>? payload]) async {
    final client = HttpClient()..connectionTimeout = _networkTimeout;
    try {
      final request = await client
          .postUrl(Uri.parse('https://api.telegram.org/bot$botToken/$method'));
      request.headers.contentType = ContentType.json;
      request.write(jsonEncode(payload ?? <String, dynamic>{}));
      final response = await request.close().timeout(_networkTimeout);
      final raw = await utf8.decodeStream(response).timeout(_networkTimeout);
      final data = raw.isEmpty
          ? <String, dynamic>{}
          : jsonDecode(raw) as Map<String, dynamic>;
      if (response.statusCode < 200 ||
          response.statusCode >= 300 ||
          data['ok'] == false) {
        throw TelegramApiException(
            'Telegram API gagal (${response.statusCode}): $raw');
      }
      final result = data['result'];
      if (result is Map<dynamic, dynamic>) {
        return Map<String, dynamic>.from(result);
      }
      return <String, dynamic>{'value': result};
    } finally {
      client.close(force: true);
    }
  }
}

class TelegramApiException implements Exception {
  TelegramApiException(this.message);
  final String message;

  @override
  String toString() => message;
}
