import '../core/models/setup_models.dart';

/// In-memory OTP history tracker (per session).
/// Stores OTP entries detected from emails for quick access.
class OtpHistoryEntry {
  const OtpHistoryEntry({
    required this.code,
    required this.sender,
    required this.subject,
    required this.detectedAt,
    required this.messageId,
  });

  final String code;
  final String sender;
  final String subject;
  final DateTime detectedAt;
  final String messageId;
}

class OtpHistoryService {
  final List<OtpHistoryEntry> _entries = <OtpHistoryEntry>[];
  final Set<String> _seenMessageIds = <String>{};

  List<OtpHistoryEntry> get entries => List<OtpHistoryEntry>.unmodifiable(
      _entries.reversed.toList(growable: false));

  int get count => _entries.length;

  /// Scans messages for OTP codes and adds new ones to history.
  /// Returns newly detected entries (not previously seen).
  List<OtpHistoryEntry> processMessages(List<InboxMessage> messages) {
    final newEntries = <OtpHistoryEntry>[];
    for (final message in messages) {
      if (!message.isOtp) continue;
      if (message.otpCode == '-' || message.otpCode.isEmpty) continue;
      if (_seenMessageIds.contains(message.id)) continue;

      _seenMessageIds.add(message.id);
      final entry = OtpHistoryEntry(
        code: message.otpCode,
        sender: message.sender,
        subject: message.subject,
        detectedAt: message.receivedAt,
        messageId: message.id,
      );
      _entries.add(entry);
      newEntries.add(entry);
    }
    return newEntries;
  }

  void clear() {
    _entries.clear();
    _seenMessageIds.clear();
  }
}
