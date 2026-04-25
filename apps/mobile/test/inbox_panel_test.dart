import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:telegram_tempmail_mobile/core/models/setup_models.dart';
import 'package:telegram_tempmail_mobile/features/home/inbox_panel.dart';

void main() {
  const state = MobileSetupState(
    primaryDomain: 'example.com',
    scriptName: 'telegram-tempmail',
    workerUrl: 'https://telegram-tempmail.example.workers.dev',
    dashboardUrl: 'https://telegram-tempmail.example.workers.dev/app',
    botUsername: 'bot',
    domains: <String>['example.com'],
    accountId: 'account-id',
    d1DatabaseId: 'd1-id',
  );

  testWidgets('locked inbox renders secure credential call to action',
      (tester) async {
    var saved = false;
    var opened = '';
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: InboxPanel(
            state: state,
            credentials: null,
            onOpenUrl: (url) => opened = url,
            onCopyText: (_) {},
            onSaveCredentials: () => saved = true,
          ),
        ),
      ),
    );

    expect(find.text('Inbox'), findsOneWidget);
    expect(find.text('Native inbox locked'), findsOneWidget);
    expect(find.text('Save credentials'), findsOneWidget);

    await tester.tap(find.text('Save credentials'));
    expect(saved, isTrue);

    await tester.tap(find.text('Web dashboard'));
    expect(opened, state.dashboardUrl);
  });
}
