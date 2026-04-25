import 'package:flutter_test/flutter_test.dart';
import 'package:telegram_tempmail_mobile/services/provisioning_service.dart';

void main() {
  test('initialSteps exposes setup stages in operator order', () {
    final steps = const ProvisioningService().initialSteps();
    expect(steps.map((step) => step.id), <String>[
      'telegram',
      'zone',
      'kv',
      'd1',
      'worker',
      'schema',
      'secrets',
      'subdomain',
      'routing',
      'catchall',
      'webhook',
    ]);
  });

  test('normalizeCatchAllTarget extracts worker action target', () {
    expect(
      ProvisioningService.normalizeCatchAllTarget(<String, dynamic>{
        'actions': <Map<String, dynamic>>[
          <String, dynamic>{
            'type': 'worker',
            'value': <String>['telegram-tempmail']
          },
        ],
      }),
      'telegram-tempmail',
    );
  });

  test('normalizeCatchAllTarget returns empty when no worker action exists',
      () {
    expect(
      ProvisioningService.normalizeCatchAllTarget(<String, dynamic>{
        'actions': <Map<String, dynamic>>[
          <String, dynamic>{
            'type': 'forward',
            'value': <String>['owner@example.com']
          },
        ],
      }),
      '',
    );
  });
}
