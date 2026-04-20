import 'dart:convert';
import 'dart:io';

class CloudflareApi {
  CloudflareApi({required this.email, required this.globalApiKey});

  final String email;
  final String globalApiKey;
  final String baseUrl = 'https://api.cloudflare.com/client/v4';

  Map<String, String> get _baseHeaders => <String, String>{
        'X-Auth-Email': email,
        'X-Auth-Key': globalApiKey,
        'Accept': 'application/json',
      };

  Future<Map<String, dynamic>> getActiveZone(String domain) async {
    final uri = Uri.parse('$baseUrl/zones?name=${Uri.encodeQueryComponent(domain)}&status=active&per_page=1');
    final response = await _requestJson(uri, method: 'GET');
    final result = (response['result'] as List<dynamic>? ?? <dynamic>[]);
    if (result.isEmpty) {
      throw CloudflareApiException('Domain belum Active atau tidak ditemukan di Cloudflare: $domain');
    }
    return Map<String, dynamic>.from(result.first as Map<dynamic, dynamic>);
  }

  Future<String> getAccountWorkersSubdomain(String accountId) async {
    final response = await _requestJson(Uri.parse('$baseUrl/accounts/$accountId/workers/subdomain'), method: 'GET');
    final result = Map<String, dynamic>.from(response['result'] as Map<dynamic, dynamic>? ?? <dynamic, dynamic>{});
    final subdomain = result['subdomain']?.toString() ?? '';
    if (subdomain.isEmpty) {
      throw CloudflareApiException('Workers subdomain belum dikonfigurasi di akun Cloudflare ini.');
    }
    return subdomain;
  }

  Future<List<Map<String, dynamic>>> listKVNamespaces(String accountId) async {
    final response = await _requestJson(
      Uri.parse('$baseUrl/accounts/$accountId/storage/kv/namespaces?per_page=100&page=1'),
      method: 'GET',
    );
    return _resultList(response);
  }

  Future<Map<String, dynamic>> findOrCreateKVNamespace(String accountId, String title) async {
    final namespaces = await listKVNamespaces(accountId);
    for (final namespace in namespaces) {
      if (namespace['title'] == title) return namespace;
    }
    final response = await _requestJson(
      Uri.parse('$baseUrl/accounts/$accountId/storage/kv/namespaces'),
      method: 'POST',
      body: <String, dynamic>{'title': title},
    );
    return Map<String, dynamic>.from(response['result'] as Map<dynamic, dynamic>);
  }

  Future<List<Map<String, dynamic>>> listD1Databases(String accountId) async {
    final response = await _requestJson(
      Uri.parse('$baseUrl/accounts/$accountId/d1/database?page=1&per_page=100'),
      method: 'GET',
    );
    return _resultList(response);
  }

  Future<Map<String, dynamic>> findOrCreateD1Database(String accountId, String name) async {
    final databases = await listD1Databases(accountId);
    for (final database in databases) {
      if (database['name'] == name) return database;
    }
    final response = await _requestJson(
      Uri.parse('$baseUrl/accounts/$accountId/d1/database'),
      method: 'POST',
      body: <String, dynamic>{'name': name},
    );
    return Map<String, dynamic>.from(response['result'] as Map<dynamic, dynamic>);
  }

  Future<List<Map<String, dynamic>>> queryD1(String accountId, String databaseId, String sql, [List<Object?> params = const <Object?>[]]) async {
    final response = await _requestJson(
      Uri.parse('$baseUrl/accounts/$accountId/d1/database/$databaseId/query'),
      method: 'POST',
      body: <String, dynamic>{'sql': sql, 'params': params},
    );
    return _resultList(response);
  }

  Future<void> uploadWorkerScript({
    required String accountId,
    required String scriptName,
    required String sourceCode,
    required String domain,
    required String kvNamespaceId,
    required String compatibilityDate,
    required String d1DatabaseId,
  }) async {
    final bindings = <Map<String, dynamic>>[
      <String, dynamic>{'type': 'plain_text', 'name': 'DOMAIN', 'text': domain},
      <String, dynamic>{'type': 'kv_namespace', 'name': 'STATE_KV', 'namespace_id': kvNamespaceId},
      <String, dynamic>{'type': 'd1', 'name': 'MAIL_DB', 'database_id': d1DatabaseId},
    ];
    final metadata = <String, dynamic>{
      'main_module': 'main.js',
      'compatibility_date': compatibilityDate,
      'bindings': bindings,
    };
    await _requestMultipart(
      Uri.parse('$baseUrl/accounts/$accountId/workers/scripts/$scriptName'),
      fields: <String, String>{'metadata': jsonEncode(metadata)},
      files: <MultipartTextFile>[
        MultipartTextFile(
          fieldName: 'main.js',
          fileName: 'main.js',
          contentType: 'application/javascript+module',
          content: sourceCode,
        ),
      ],
    );
  }

  Future<void> setWorkerSecret(String accountId, String scriptName, String name, String text) async {
    await _requestJson(
      Uri.parse('$baseUrl/accounts/$accountId/workers/scripts/$scriptName/secrets'),
      method: 'PUT',
      body: <String, dynamic>{'name': name, 'text': text, 'type': 'secret_text'},
    );
  }

  Future<void> enableWorkerSubdomain(String accountId, String scriptName) async {
    await _requestJson(
      Uri.parse('$baseUrl/accounts/$accountId/workers/scripts/$scriptName/subdomain'),
      method: 'POST',
      body: <String, dynamic>{'enabled': true, 'previews_enabled': false},
    );
  }

  Future<Map<String, dynamic>> getWorkerSettings(String accountId, String scriptName) async {
    final response = await _requestJson(Uri.parse('$baseUrl/accounts/$accountId/workers/scripts/$scriptName/settings'), method: 'GET');
    return Map<String, dynamic>.from(response['result'] as Map<dynamic, dynamic>);
  }

  Future<Map<String, dynamic>> getEmailRouting(String zoneId) async {
    final response = await _requestJson(Uri.parse('$baseUrl/zones/$zoneId/email/routing'), method: 'GET');
    return Map<String, dynamic>.from(response['result'] as Map<dynamic, dynamic>);
  }

  Future<void> enableEmailRoutingDns(String zoneId) async {
    await _requestJson(Uri.parse('$baseUrl/zones/$zoneId/email/routing/dns'), method: 'POST');
  }

  Future<Map<String, dynamic>> getCatchAllRule(String zoneId) async {
    final response = await _requestJson(Uri.parse('$baseUrl/zones/$zoneId/email/routing/rules/catch_all'), method: 'GET');
    return Map<String, dynamic>.from(response['result'] as Map<dynamic, dynamic>? ?? <dynamic, dynamic>{});
  }

  Future<void> setCatchAllWorker(String zoneId, String scriptName) async {
    await _requestJson(
      Uri.parse('$baseUrl/zones/$zoneId/email/routing/rules/catch_all'),
      method: 'PUT',
      body: <String, dynamic>{
        'name': 'Telegram TempMail Catch-all',
        'enabled': true,
        'matchers': <Map<String, dynamic>>[
          <String, dynamic>{'type': 'all'},
        ],
        'actions': <Map<String, dynamic>>[
          <String, dynamic>{'type': 'worker', 'value': <String>[scriptName]},
        ],
      },
    );
  }

  Future<String?> getKVValue(String accountId, String namespaceId, String keyName) async {
    final client = HttpClient();
    try {
      final request = await client.getUrl(Uri.parse('$baseUrl/accounts/$accountId/storage/kv/namespaces/$namespaceId/values/${Uri.encodeComponent(keyName)}'));
      _baseHeaders.forEach(request.headers.set);
      final response = await request.close();
      if (response.statusCode == 404) return null;
      final raw = await utf8.decodeStream(response);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw CloudflareApiException('Cloudflare KV GET gagal (${response.statusCode}): $raw');
      }
      return raw;
    } finally {
      client.close(force: true);
    }
  }

  Future<void> putKVValue(String accountId, String namespaceId, String keyName, String value) async {
    final client = HttpClient();
    try {
      final request = await client.putUrl(Uri.parse('$baseUrl/accounts/$accountId/storage/kv/namespaces/$namespaceId/values/${Uri.encodeComponent(keyName)}'));
      _baseHeaders.forEach(request.headers.set);
      request.headers.contentType = ContentType('text', 'plain', charset: 'utf-8');
      request.write(value);
      final response = await request.close();
      final raw = await utf8.decodeStream(response);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw CloudflareApiException('Cloudflare KV PUT gagal (${response.statusCode}): $raw');
      }
      if (raw.isNotEmpty) {
        final data = jsonDecode(raw) as Map<String, dynamic>;
        if (data['success'] == false) {
          throw CloudflareApiException('Cloudflare KV PUT gagal: $raw');
        }
      }
    } finally {
      client.close(force: true);
    }
  }

  Future<Map<String, dynamic>> _requestJson(Uri uri, {required String method, Object? body}) async {
    final client = HttpClient();
    try {
      final request = await client.openUrl(method, uri);
      _baseHeaders.forEach(request.headers.set);
      request.headers.contentType = ContentType.json;
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

  Future<void> _requestMultipart(Uri uri, {required Map<String, String> fields, required List<MultipartTextFile> files}) async {
    final boundary = '----telegram-tempmail-${DateTime.now().microsecondsSinceEpoch}';
    final chunks = <List<int>>[];
    for (final entry in fields.entries) {
      chunks.add(utf8.encode('--$boundary\r\n'));
      chunks.add(utf8.encode('Content-Disposition: form-data; name="${entry.key}"\r\n\r\n'));
      chunks.add(utf8.encode('${entry.value}\r\n'));
    }
    for (final file in files) {
      chunks.add(utf8.encode('--$boundary\r\n'));
      chunks.add(utf8.encode('Content-Disposition: form-data; name="${file.fieldName}"; filename="${file.fileName}"\r\n'));
      chunks.add(utf8.encode('Content-Type: ${file.contentType}\r\n\r\n'));
      chunks.add(utf8.encode(file.content));
      chunks.add(utf8.encode('\r\n'));
    }
    chunks.add(utf8.encode('--$boundary--\r\n'));

    final client = HttpClient();
    try {
      final request = await client.putUrl(uri);
      _baseHeaders.forEach(request.headers.set);
      request.headers.contentType = ContentType('multipart', 'form-data', parameters: <String, String>{'boundary': boundary});
      final contentLength = chunks.fold<int>(0, (total, chunk) => total + chunk.length);
      request.contentLength = contentLength;
      for (final chunk in chunks) {
        request.add(chunk);
      }
      final response = await request.close();
      final raw = await utf8.decodeStream(response);
      final data = raw.isEmpty ? <String, dynamic>{} : jsonDecode(raw) as Map<String, dynamic>;
      if (response.statusCode < 200 || response.statusCode >= 300 || data['success'] == false) {
        throw CloudflareApiException('Cloudflare Worker upload gagal (${response.statusCode}): $raw');
      }
    } finally {
      client.close(force: true);
    }
  }

  List<Map<String, dynamic>> _resultList(Map<String, dynamic> response) {
    final raw = response['result'];
    if (raw is List<dynamic>) {
      return raw.map((item) => Map<String, dynamic>.from(item as Map<dynamic, dynamic>)).toList(growable: false);
    }
    return <Map<String, dynamic>>[];
  }
}

class MultipartTextFile {
  const MultipartTextFile({
    required this.fieldName,
    required this.fileName,
    required this.contentType,
    required this.content,
  });

  final String fieldName;
  final String fileName;
  final String contentType;
  final String content;
}

class CloudflareApiException implements Exception {
  CloudflareApiException(this.message);
  final String message;

  @override
  String toString() => message;
}
