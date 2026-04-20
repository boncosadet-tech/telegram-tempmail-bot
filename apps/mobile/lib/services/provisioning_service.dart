import '../core/models/setup_models.dart';

class ProvisioningService {
  const ProvisioningService();

  List<ProvisioningStep> initialSteps() {
    return const <ProvisioningStep>[
      ProvisioningStep(id: 'telegram', title: 'Validate Telegram bot'),
      ProvisioningStep(id: 'zone', title: 'Resolve Cloudflare zone'),
      ProvisioningStep(id: 'kv', title: 'Ensure KV namespace'),
      ProvisioningStep(id: 'd1', title: 'Ensure D1 database'),
      ProvisioningStep(id: 'worker', title: 'Upload Worker'),
      ProvisioningStep(id: 'schema', title: 'Apply D1 schema'),
      ProvisioningStep(id: 'secrets', title: 'Set Worker secrets'),
      ProvisioningStep(id: 'subdomain', title: 'Enable workers.dev endpoint'),
      ProvisioningStep(id: 'routing', title: 'Enable Email Routing DNS'),
      ProvisioningStep(id: 'catchall', title: 'Set catch-all Worker route'),
      ProvisioningStep(id: 'webhook', title: 'Configure Telegram webhook'),
    ];
  }

  Stream<List<ProvisioningStep>> dryRunSetup(SetupDraft draft) async* {
    final steps = initialSteps().toList();
    for (var index = 0; index < steps.length; index += 1) {
      steps[index] = steps[index].copyWith(
        status: ProvisioningStepStatus.running,
        detail: 'Preparing ${draft.normalizedDomain}',
      );
      yield List<ProvisioningStep>.unmodifiable(steps);
      await Future<void>.delayed(const Duration(milliseconds: 180));
      steps[index] = steps[index].copyWith(
        status: ProvisioningStepStatus.ok,
        detail: 'Ready for API integration',
      );
      yield List<ProvisioningStep>.unmodifiable(steps);
    }
  }

  // TODO(next): port src/lib/service.js performSetup/addDomainToApp/performVerify
  // into Dart so this service executes real Cloudflare + Telegram provisioning
  // directly from the Android device without Termux.
}
