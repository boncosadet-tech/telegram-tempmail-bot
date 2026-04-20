import 'package:flutter_test/flutter_test.dart';
import 'package:telegram_tempmail_mobile/core/validators/input_validators.dart';

void main() {
  test('normalizeDomain strips scheme, path, and casing', () {
    expect(InputValidators.normalizeDomain('HTTPS://Excalibur.Email/app'), 'excalibur.email');
  });

  test('isDomain accepts common Cloudflare zone names', () {
    expect(InputValidators.isDomain('dahus.my.id'), isTrue);
    expect(InputValidators.isDomain('excalibur.email'), isTrue);
    expect(InputValidators.isDomain('bad_domain'), isFalse);
  });

  test('normalizeScriptName matches worker naming constraints', () {
    expect(InputValidators.normalizeScriptName('', 'Example.COM'), 'telegram-tempmail-example-com');
    expect(InputValidators.normalizeScriptName('My Worker!!', 'example.com'), 'my-worker');
  });

  test('Telegram token validator detects bot token shape', () {
    expect(InputValidators.isTelegramBotToken('123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi_123'), isTrue);
    expect(InputValidators.isTelegramBotToken('not-a-token'), isFalse);
  });
}
