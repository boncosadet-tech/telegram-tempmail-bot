import '../validators/input_validators.dart';

class SetupDraft {
  const SetupDraft({
    required this.cloudflareEmail,
    required this.cloudflareGlobalApiKey,
    required this.telegramBotToken,
    required this.domain,
    required this.scriptName,
    required this.saveCredentials,
    required this.replaceExistingMxRecords,
  });

  final String cloudflareEmail;
  final String cloudflareGlobalApiKey;
  final String telegramBotToken;
  final String domain;
  final String scriptName;
  final bool saveCredentials;
  final bool replaceExistingMxRecords;

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

  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      'primaryDomain': primaryDomain,
      'scriptName': scriptName,
      'workerUrl': workerUrl,
      'dashboardUrl': dashboardUrl,
      'botUsername': botUsername,
      'domains': domains,
      'claimLink': claimLink,
      'accountId': accountId,
      'zoneId': zoneId,
      'kvNamespaceId': kvNamespaceId,
      'd1DatabaseId': d1DatabaseId,
    };
  }

  factory MobileSetupState.fromJson(Map<String, dynamic> json) {
    final primaryDomain = json['primaryDomain']?.toString() ?? '';
    final domains = (json['domains'] as List<dynamic>? ?? <dynamic>[]).map((item) => item.toString()).where((item) => item.isNotEmpty).toList(growable: true);
    if (domains.isEmpty && primaryDomain.isNotEmpty) domains.add(primaryDomain);
    return MobileSetupState(
      primaryDomain: primaryDomain,
      scriptName: json['scriptName']?.toString() ?? '',
      workerUrl: json['workerUrl']?.toString() ?? '',
      dashboardUrl: json['dashboardUrl']?.toString() ?? '',
      botUsername: json['botUsername']?.toString() ?? '',
      domains: List<String>.unmodifiable(domains),
      claimLink: json['claimLink']?.toString() ?? '',
      accountId: json['accountId']?.toString() ?? '',
      zoneId: json['zoneId']?.toString() ?? '',
      kvNamespaceId: json['kvNamespaceId']?.toString() ?? '',
      d1DatabaseId: json['d1DatabaseId']?.toString() ?? '',
    );
  }
}

class StoredCredentials {
  const StoredCredentials({
    required this.cloudflareEmail,
    required this.cloudflareGlobalApiKey,
    required this.telegramBotToken,
  });

  final String cloudflareEmail;
  final String cloudflareGlobalApiKey;
  final String telegramBotToken;

  bool get isComplete {
    return InputValidators.isCloudflareEmail(cloudflareEmail) &&
        InputValidators.isGlobalApiKey(cloudflareGlobalApiKey) &&
        InputValidators.isTelegramBotToken(telegramBotToken);
  }
}

class InboxMessage {
  const InboxMessage({
    required this.id,
    required this.aliasFull,
    required this.sender,
    required this.subject,
    required this.previewText,
    required this.renderedHtml,
    required this.otpCode,
    required this.isOtp,
    required this.receivedAt,
  });

  final String id;
  final String aliasFull;
  final String sender;
  final String subject;
  final String previewText;
  final String renderedHtml;
  final String otpCode;
  final bool isOtp;
  final DateTime receivedAt;

  factory InboxMessage.fromD1Row(Map<String, dynamic> row) {
    return InboxMessage(
      id: row['id']?.toString() ?? '',
      aliasFull: row['alias_full']?.toString() ?? '',
      sender: row['sender']?.toString() ?? '-',
      subject: row['subject']?.toString() ?? '(no subject)',
      previewText: row['preview_text']?.toString() ?? '',
      renderedHtml: row['rendered_html']?.toString() ?? '',
      otpCode: row['otp_code']?.toString() ?? '-',
      isOtp: row['is_otp']?.toString() == '1' || row['is_otp'] == true,
      receivedAt: DateTime.fromMillisecondsSinceEpoch(_asInt(row['received_at']) * 1000),
    );
  }

  static int _asInt(Object? value) {
    if (value is int) return value;
    if (value is num) return value.toInt();
    return int.tryParse(value?.toString() ?? '') ?? 0;
  }
}
