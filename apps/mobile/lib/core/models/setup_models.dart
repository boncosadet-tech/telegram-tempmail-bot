import '../validators/input_validators.dart';

class SetupDraft {
  const SetupDraft({
    required this.cloudflareEmail,
    required this.cloudflareGlobalApiKey,
    required this.telegramBotToken,
    required this.domain,
    required this.scriptName,
    required this.saveCredentials,
  });

  final String cloudflareEmail;
  final String cloudflareGlobalApiKey;
  final String telegramBotToken;
  final String domain;
  final String scriptName;
  final bool saveCredentials;

  String get normalizedDomain => InputValidators.normalizeDomain(domain);

  String get effectiveScriptName => InputValidators.normalizeScriptName(scriptName, domain);

  bool get isValid {
    return InputValidators.isCloudflareEmail(cloudflareEmail) &&
        InputValidators.isGlobalApiKey(cloudflareGlobalApiKey) &&
        InputValidators.isTelegramBotToken(telegramBotToken) &&
        InputValidators.isDomain(domain) &&
        InputValidators.isScriptName(effectiveScriptName);
  }
}

enum ProvisioningStepStatus { pending, running, ok, failed }

class ProvisioningStep {
  const ProvisioningStep({
    required this.id,
    required this.title,
    this.detail = '',
    this.status = ProvisioningStepStatus.pending,
  });

  final String id;
  final String title;
  final String detail;
  final ProvisioningStepStatus status;

  ProvisioningStep copyWith({
    String? detail,
    ProvisioningStepStatus? status,
  }) {
    return ProvisioningStep(
      id: id,
      title: title,
      detail: detail ?? this.detail,
      status: status ?? this.status,
    );
  }
}

class MobileSetupState {
  const MobileSetupState({
    required this.primaryDomain,
    required this.scriptName,
    required this.workerUrl,
    required this.dashboardUrl,
    required this.botUsername,
    required this.domains,
  });

  final String primaryDomain;
  final String scriptName;
  final String workerUrl;
  final String dashboardUrl;
  final String botUsername;
  final List<String> domains;
}
