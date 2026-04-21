import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:telegram_tempmail_mobile/app.dart';

void main() {
  testWidgets('welcome CTA is tappable and opens configuration step', (tester) async {
    await tester.pumpWidget(const TempMailMobileApp());

    expect(find.text('Private TempMail'), findsWidgets);
    expect(find.text('Get Started'), findsOneWidget);

    await tester.tap(find.widgetWithText(FilledButton, 'Get Started'));
    await tester.pumpAndSettle();

    expect(find.text('Configuration'), findsOneWidget);
    expect(find.text('Cloudflare email'), findsOneWidget);
    expect(find.text('Step 2/5'), findsOneWidget);
  });

  testWidgets('secondary welcome CTA is tappable and opens configuration step', (tester) async {
    await tester.pumpWidget(const TempMailMobileApp());

    await tester.tap(find.widgetWithText(OutlinedButton, 'Open Configuration'));
    await tester.pumpAndSettle();

    expect(find.text('Configuration'), findsOneWidget);
    expect(find.text('Telegram Bot Token'), findsOneWidget);
  });
}
