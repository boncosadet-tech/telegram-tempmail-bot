import '../core/models/setup_models.dart';
import 'cloudflare_api.dart';

class InboxService {
  const InboxService();

  static const int pageSize = 30;

  Future<List<InboxMessage>> listMessages({
    required MobileSetupState state,
    required StoredCredentials credentials,
  }) async {
    _ensureReady(state, credentials);
    final api = CloudflareApi(email: credentials.cloudflareEmail, globalApiKey: credentials.cloudflareGlobalApiKey);
    final rows = await api.queryD1(
      state.accountId,
      state.d1DatabaseId,
      '''SELECT id, alias_full, sender, subject, preview_text, rendered_html, otp_code, is_otp, received_at
FROM messages
ORDER BY received_at DESC
LIMIT $pageSize''',
    );
    return rows.map(InboxMessage.fromD1Row).where((message) => message.id.isNotEmpty).toList(growable: false);
  }

  Future<InboxMessage?> getMessage({
    required MobileSetupState state,
    required StoredCredentials credentials,
    required String id,
  }) async {
    _ensureReady(state, credentials);
    if (id.trim().isEmpty) return null;
    final api = CloudflareApi(email: credentials.cloudflareEmail, globalApiKey: credentials.cloudflareGlobalApiKey);
    final rows = await api.queryD1(
      state.accountId,
      state.d1DatabaseId,
      '''SELECT id, alias_full, sender, subject, preview_text, rendered_html, otp_code, is_otp, received_at
FROM messages
WHERE id = ?
LIMIT 1''',
      <Object?>[id],
    );
    if (rows.isEmpty) return null;
    return InboxMessage.fromD1Row(rows.first);
  }

  Future<void> deleteMessage({
    required MobileSetupState state,
    required StoredCredentials credentials,
    required String id,
  }) async {
    _ensureReady(state, credentials);
    if (id.trim().isEmpty) return;
    final api = CloudflareApi(email: credentials.cloudflareEmail, globalApiKey: credentials.cloudflareGlobalApiKey);
    await api.queryD1(state.accountId, state.d1DatabaseId, 'DELETE FROM messages WHERE id = ?', <Object?>[id]);
  }

  Future<void> purgeOtp({
    required MobileSetupState state,
    required StoredCredentials credentials,
  }) async {
    _ensureReady(state, credentials);
    final api = CloudflareApi(email: credentials.cloudflareEmail, globalApiKey: credentials.cloudflareGlobalApiKey);
    await api.queryD1(state.accountId, state.d1DatabaseId, 'DELETE FROM messages WHERE is_otp = 1');
  }

  void _ensureReady(MobileSetupState state, StoredCredentials credentials) {
    if (!credentials.isComplete) {
      throw StateError('Credential Cloudflare belum lengkap. Input ulang credential untuk inbox native.');
    }
    if (state.accountId.isEmpty || state.d1DatabaseId.isEmpty) {
      throw StateError('Setup state belum punya accountId/D1 database id. Jalankan setup ulang dari app.');
    }
  }
}
