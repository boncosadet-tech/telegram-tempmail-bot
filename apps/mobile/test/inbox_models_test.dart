import 'package:flutter_test/flutter_test.dart';
import 'package:telegram_tempmail_mobile/core/models/setup_models.dart';

void main() {
  test('MobileSetupState JSON roundtrip keeps required ids', () {
    const state = MobileSetupState(
      primaryDomain: 'example.com',
      scriptName: 'telegram-tempmail',
      workerUrl: 'https://worker.example',
      dashboardUrl: 'https://worker.example/app',
      botUsername: 'bot',
      domains: <String>['example.com', 'mail.example.com'],
      accountId: 'acc',
      d1DatabaseId: 'd1',
    );

    final restored = MobileSetupState.fromJson(state.toJson());

    expect(restored.primaryDomain, 'example.com');
    expect(restored.domains, <String>['example.com', 'mail.example.com']);
    expect(restored.accountId, 'acc');
    expect(restored.d1DatabaseId, 'd1');
  });

  test('InboxMessage maps D1 row values', () {
    final message = InboxMessage.fromD1Row(<String, dynamic>{
      'id': 'msg1',
      'alias_full': 'otp@example.com',
      'sender': 'service@example.net',
      'subject': 'Your code',
      'preview_text': 'Code 123456',
      'rendered_html': '<p>Code <b>123456</b></p>',
      'otp_code': '123456',
      'is_otp': 1,
      'received_at': 1710000000,
    });

    expect(message.id, 'msg1');
    expect(message.aliasFull, 'otp@example.com');
    expect(message.isOtp, isTrue);
    expect(message.otpCode, '123456');
  });
}
