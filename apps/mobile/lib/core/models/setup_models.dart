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
    this.claimLink = '',
    this.accountId = '',
    this.zoneId = '',
    this.kvNamespaceId = '',
    this.d1DatabaseId = '',
  });

  final String primaryDomain;
  final String scriptName;
  final String workerUrl;
  final String dashboardUrl;
  final String botUsername;
  final List<String> domains;
  final String claimLink;
  final String accountId;
  final String zoneId;
  final String kvNamespaceId;
  final String d1DatabaseId;

  MobileSetupState copyWith({
    String? primaryDomain,
    String? scriptName,
    String? workerUrl,
    String? dashboardUrl,
    String? botUsername,
    List<String>? domains,
    String? claimLink,
    String? accountId,
    String? zoneId,
    String? kvNamespaceId,
    String? d1DatabaseId,
  }) {
    return MobileSetupState(
      primaryDomain: primaryDomain ?? this.primaryDomain,
      scriptName: scriptName ?? this.scriptName,
      workerUrl: workerUrl ?? this.workerUrl,
      dashboardUrl: dashboardUrl ?? this.dashboardUrl,
      botUsername: botUsername ?? this.botUsername,
      domains: domains ?? this.domains,
      claimLink: claimLink ?? this.claimLink,
      accountId: accountId ?? this.accountId,
      zoneId: zoneId ?? this.zoneId,
      kvNamespaceId: kvNamespaceId ?? this.kvNamespaceId,
      d1DatabaseId: d1DatabaseId ?? this.d1DatabaseId,
    );
  }
}
