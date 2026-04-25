import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:telegram_tempmail_mobile/core/models/setup_models.dart';
import 'package:telegram_tempmail_mobile/services/secure_config_store.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = MethodChannel('telegram_tempmail/native');
  final values = <String, String>{};

  setUp(() {
    values.clear();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      final args = Map<String, dynamic>.from(
          call.arguments as Map<dynamic, dynamic>? ?? <dynamic, dynamic>{});
      switch (call.method) {
        case 'secureSave':
          values[args['key'].toString()] = args['value'].toString();
          return true;
        case 'secureRead':
          return values[args['key'].toString()];
        case 'secureDelete':
          values.remove(args['key'].toString());
          return true;
        case 'secureClear':
          values.clear();
          return true;
      }
      return null;
    });
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  test('setup state persists through native secure channel', () async {
    const store = SecureConfigStore();
    const state = MobileSetupState(
      primaryDomain: 'example.com',
      scriptName: 'telegram-tempmail',
      workerUrl: 'https://telegram-tempmail.example.workers.dev',
      dashboardUrl: 'https://telegram-tempmail.example.workers.dev/app',
      botUsername: 'tempmailbot',
      domains: <String>['example.com'],
      accountId: 'account-id',
      d1DatabaseId: 'd1-id',
    );

    await store.saveSetupState(state);
    final restored = await store.readSetupState();

    expect(restored, isNotNull);
    expect(restored!.primaryDomain, 'example.com');
    expect(restored.d1DatabaseId, 'd1-id');
  });

  test('credentials are only returned when complete', () async {
    const store = SecureConfigStore();
    const draft = SetupDraft(
      cloudflareEmail: 'owner@example.com',
      cloudflareGlobalApiKey: 'abcdefghijklmnopqrstuvwxyz',
      telegramBotToken: '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi_123',
      domain: 'example.com',
      scriptName: 'telegram-tempmail',
      saveCredentials: true,
      replaceExistingMxRecords: false,
    );

    await store.saveCredentials(draft);
    final credentials = await store.readCredentials();

    expect(credentials, isNotNull);
    expect(credentials!.isComplete, isTrue);
    expect(credentials.hasTelegramBotToken, isTrue);
    expect(credentials.cloudflareEmail, 'owner@example.com');
  });
}
