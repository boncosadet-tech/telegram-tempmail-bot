import 'dart:convert';
import 'dart:io';

class CloudflareApi {
  CloudflareApi({required this.email, required this.globalApiKey});

  final String email;
  final String globalApiKey;
  final String baseUrl = 'https://api.cloudflare.com/client/v4';

  Map<String, String> get _headers => <String, String>{
        'X-Auth-Email': email,
        'X-Auth-Key': globalApiKey,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      };

  Future<Map<String, dynamic>> getActiveZone(String domain) async {
    final uri = Uri.parse('$baseUrl/zones?name=$domain&status=active&per_page=1');
    final response = await _request(uri, method: 'GET');
    final result = (response['result'] as List<dynamic>? ?? <dynamic>[]);
    if (result.isEmpty) {
      throw CloudflareApiException('Domain belum Active atau tidak ditemukan di Cloudflare: $domain');
    }
    return Map<String, dynamic>.from(result.first as Map<dynamic, dynamic>);
  }

  Future<Map<String, dynamic>> getEmailRouting(String zoneId) async {
    final uri = Uri.parse('$baseUrl/zones/$zoneId/email/routing');
    final response = await _request(uri, method: 'GET');
    return Map<String, dynamic>.from(response['result'] as Map<dynamic, dynamic>);
  }

  Future<Map<String, dynamic>> _request(Uri uri, {required String method, Object? body}) async {
    final client = HttpClient();
    try {
      final request = await client.openUrl(method, uri);
      _headers.forEach(request.headers.set);
      if (body != null) {
        request.write(jsonEncode(body));
      }
      final response = await request.close();
      final raw = await utf8.decodeStream(response);
      final data = raw.isEmpty ? <String, dynamic>{} : jsonDecode(raw) as Map<String, dynamic>;
      if (response.statusCode < 200 || response.statusCode >= 300 || data['success'] == false) {
        throw CloudflareApiException('Cloudflare API gagal (${response.statusCode}): $raw');
      }
      return data;
    } finally {
      client.close(force: true);
    }
  }
}

class CloudflareApiException implements Exception {
  CloudflareApiException(this.message);
  final String message;

  @override
  String toString() => message;
}
