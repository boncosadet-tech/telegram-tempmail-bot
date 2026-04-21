import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:telegram_tempmail_mobile/app.dart';

void main() {
  const channel = MethodChannel('telegram_tempmail/native');

  setUp(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, (call) async {
      if (call.method == 'secureRead') return null;
      return true;
    });
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, null);
  });

  testWidgets('welcome CTA is tappable and opens configuration step', (tester) async {
    await tester.pumpWidget(const TempMailMobileApp());
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('Private TempMail'), findsWidgets);
    expect(find.text('Get Started'), findsOneWidget);

    await tester.tap(find.widgetWithText(FilledButton, 'Get Started'));
    await tester.pump(const Duration(milliseconds: 350));

    expect(find.text('Configuration'), findsOneWidget);
    expect(find.text('Cloudflare email'), findsOneWidget);
    expect(find.text('Step 2/5'), findsOneWidget);
  });

  testWidgets('secondary welcome CTA is tappable and opens configuration step', (tester) async {
    await tester.pumpWidget(const TempMailMobileApp());
    await tester.pump(const Duration(milliseconds: 100));

    await tester.tap(find.widgetWithText(OutlinedButton, 'Open Configuration'));
    await tester.pump(const Duration(milliseconds: 350));

    expect(find.text('Configuration'), findsOneWidget);
    expect(find.text('Telegram Bot Token'), findsOneWidget);
  });
}
