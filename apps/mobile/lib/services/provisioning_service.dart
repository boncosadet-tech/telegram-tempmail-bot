import 'dart:convert';
import 'dart:math';

import '../core/models/setup_models.dart';
import '../core/validators/input_validators.dart';
import 'cloudflare_api.dart';
import 'telegram_api.dart';

class ProvisioningService {
  const ProvisioningService();

  static const List<String> _d1SchemaStatements = <String>[
    '''CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    alias_local TEXT NOT NULL,
    alias_full TEXT NOT NULL,
    sender TEXT NOT NULL,
    subject TEXT NOT NULL,
    preview_text TEXT NOT NULL,
    rendered_html TEXT NOT NULL DEFAULT '',
    otp_code TEXT NOT NULL DEFAULT '-',
    is_otp INTEGER NOT NULL DEFAULT 0,
    size_kb INTEGER NOT NULL DEFAULT 0,
    raw_kind TEXT NOT NULL DEFAULT 'unknown',
    received_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )''',
    'CREATE INDEX IF NOT EXISTS idx_messages_received_at ON messages (received_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_messages_alias_local ON messages (alias_local, received_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_messages_expires_at ON messages (expires_at)',
    '''CREATE TABLE IF NOT EXISTS aliases (
    alias_local TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    is_pinned INTEGER NOT NULL DEFAULT 0
  )''',
  ];

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

  Stream<ProvisioningUpdate> runSetup(SetupDraft draft, {required String workerSource}) async* {
    var steps = initialSteps();
    String currentStep = 'telegram';
    String? accountId;
    String? zoneId;
    String? accountSubdomain;
    String? kvNamespaceId;
    String? d1DatabaseId;
    String botUsername = '';

    final domain = draft.normalizedDomain;
    final scriptName = draft.effectiveScriptName;
    final cf = CloudflareApi(email: draft.cloudflareEmail.trim(), globalApiKey: draft.cloudflareGlobalApiKey.trim());
    final tg = TelegramApi(draft.telegramBotToken.trim());
    final webhookSecret = _randomToken(36);

    try {
      currentStep = 'telegram';
      steps = _setStep(steps, currentStep, ProvisioningStepStatus.running, 'Checking bot token');
      yield ProvisioningUpdate(steps: steps);
      final bot = await tg.getMe();
      botUsername = bot['username']?.toString() ?? '';
      if (botUsername.isEmpty) {
        throw ProvisioningException('Telegram bot harus punya username sebelum setup.');
      }
      steps = _setStep(steps, currentStep, ProvisioningStepStatus.ok, '@$botUsername');
      yield ProvisioningUpdate(steps: steps);

      currentStep = 'zone';
      steps = _setStep(steps, currentStep, ProvisioningStepStatus.running, domain);
      yield ProvisioningUpdate(steps: steps);
      final zone = await cf.getActiveZone(domain);
      zoneId = zone['id']?.toString();
      accountId = (zone['account'] as Map<dynamic, dynamic>?)?['id']?.toString();
      if (zoneId == null || zoneId.isEmpty || accountId == null || accountId.isEmpty) {
        throw ProvisioningException('Cloudflare zone tidak punya zone/account id.');
      }
      accountSubdomain = await cf.getAccountWorkersSubdomain(accountId);
      steps = _setStep(steps, currentStep, ProvisioningStepStatus.ok, '${zone['name']} ($zoneId)');
      yield ProvisioningUpdate(steps: steps);

      currentStep = 'kv';
      steps = _setStep(steps, currentStep, ProvisioningStepStatus.running, 'telegram-tempmail:$domain');
      yield ProvisioningUpdate(steps: steps);
      final kv = await cf.findOrCreateKVNamespace(accountId, 'telegram-tempmail:$domain');
      kvNamespaceId = kv['id']?.toString();
      if (kvNamespaceId == null || kvNamespaceId.isEmpty) {
        throw ProvisioningException('KV namespace id kosong.');
      }
      steps = _setStep(steps, currentStep, ProvisioningStepStatus.ok, kvNamespaceId);
      yield ProvisioningUpdate(steps: steps);

      currentStep = 'd1';
      final d1Name = InputValidators.normalizeScriptName('telegram-tempmail-$domain', domain);
      steps = _setStep(steps, currentStep, ProvisioningStepStatus.running, d1Name);
      yield ProvisioningUpdate(steps: steps);
      final d1 = await cf.findOrCreateD1Database(accountId, d1Name);
      d1DatabaseId = (d1['uuid'] ?? d1['id'])?.toString();
      if (d1DatabaseId == null || d1DatabaseId.isEmpty) {
        throw ProvisioningException('D1 database id kosong.');
      }
      steps = _setStep(steps, currentStep, ProvisioningStepStatus.ok, d1DatabaseId);
      yield ProvisioningUpdate(steps: steps);

      currentStep = 'worker';
      steps = _setStep(steps, currentStep, ProvisioningStepStatus.running, scriptName);
      yield ProvisioningUpdate(steps: steps);
      await cf.uploadWorkerScript(
        accountId: accountId,
        scriptName: scriptName,
        sourceCode: workerSource,
        domain: domain,
        kvNamespaceId: kvNamespaceId,
        compatibilityDate: '2026-04-18',
        d1DatabaseId: d1DatabaseId,
      );
      steps = _setStep(steps, currentStep, ProvisioningStepStatus.ok, scriptName);
      yield ProvisioningUpdate(steps: steps);

      currentStep = 'schema';
      steps = _setStep(steps, currentStep, ProvisioningStepStatus.running, 'Creating inbox tables');
      yield ProvisioningUpdate(steps: steps);
      for (final statement in _d1SchemaStatements) {
        await cf.queryD1(accountId, d1DatabaseId, statement);
      }
      try {
        await cf.queryD1(accountId, d1DatabaseId, "ALTER TABLE messages ADD COLUMN rendered_html TEXT NOT NULL DEFAULT ''");
      } on Object catch (error) {
        if (!error.toString().toLowerCase().contains('duplicate column')) rethrow;
      }
      steps = _setStep(steps, currentStep, ProvisioningStepStatus.ok, 'Schema ready');
      yield ProvisioningUpdate(steps: steps);

      currentStep = 'secrets';
      steps = _setStep(steps, currentStep, ProvisioningStepStatus.running, 'BOT_TOKEN + WEBHOOK_SECRET');
      yield ProvisioningUpdate(steps: steps);
      await cf.setWorkerSecret(accountId, scriptName, 'BOT_TOKEN', draft.telegramBotToken.trim());
      await cf.setWorkerSecret(accountId, scriptName, 'WEBHOOK_SECRET', webhookSecret);
      await cf.putKVValue(accountId, kvNamespaceId, 'domains', jsonEncode(<String>[domain]));
      steps = _setStep(steps, currentStep, ProvisioningStepStatus.ok, 'Secrets stored');
      yield ProvisioningUpdate(steps: steps);

      currentStep = 'subdomain';
      steps = _setStep(steps, currentStep, ProvisioningStepStatus.running, accountSubdomain);
      yield ProvisioningUpdate(steps: steps);
      await cf.enableWorkerSubdomain(accountId, scriptName);
      final workerUrl = 'https://$scriptName.$accountSubdomain.workers.dev';
      steps = _setStep(steps, currentStep, ProvisioningStepStatus.ok, workerUrl);
      yield ProvisioningUpdate(steps: steps);

      currentStep = 'routing';
      steps = _setStep(steps, currentStep, ProvisioningStepStatus.running, 'Enable routing DNS');
      yield ProvisioningUpdate(steps: steps);
      try {
        await cf.enableEmailRoutingDns(zoneId);
      } on CloudflareApiException catch (error) {
        if (!error.hasCode(2008) || !draft.replaceExistingMxRecords) rethrow;
        steps = _setStep(steps, currentStep, ProvisioningStepStatus.running, 'Deleting old non-Cloudflare MX records');
        yield ProvisioningUpdate(steps: steps);
        final deleted = await cf.deleteNonCloudflareMxRecords(zoneId);
        await cf.enableEmailRoutingDns(zoneId);
        steps = _setStep(steps, currentStep, ProvisioningStepStatus.ok, 'Email Routing DNS ready; deleted $deleted old MX record(s)');
        yield ProvisioningUpdate(steps: steps);
      }
      if (steps.firstWhere((step) => step.id == currentStep).status != ProvisioningStepStatus.ok) {
        steps = _setStep(steps, currentStep, ProvisioningStepStatus.ok, 'Email Routing DNS ready');
        yield ProvisioningUpdate(steps: steps);
      }

      currentStep = 'catchall';
      steps = _setStep(steps, currentStep, ProvisioningStepStatus.running, 'Check catch-all');
      yield ProvisioningUpdate(steps: steps);
      final catchAll = await cf.getCatchAllRule(zoneId);
      final existingTarget = normalizeCatchAllTarget(catchAll);
      if (existingTarget.isNotEmpty && existingTarget != scriptName) {
        throw ProvisioningException('Catch-all sudah mengarah ke Worker "$existingTarget". Mobile MVP belum force replace; pakai npm admin --force dulu.');
      }
      await cf.setCatchAllWorker(zoneId, scriptName);
      steps = _setStep(steps, currentStep, ProvisioningStepStatus.ok, scriptName);
      yield ProvisioningUpdate(steps: steps);

      currentStep = 'webhook';
      final webhookUrl = '$workerUrl/tg/$webhookSecret';
      steps = _setStep(steps, currentStep, ProvisioningStepStatus.running, 'Set Telegram webhook');
      yield ProvisioningUpdate(steps: steps);
      await tg.setWebhook(url: webhookUrl, secretToken: webhookSecret);
      steps = _setStep(steps, currentStep, ProvisioningStepStatus.ok, 'Webhook ready');
      final state = MobileSetupState(
        primaryDomain: domain,
        scriptName: scriptName,
        workerUrl: workerUrl,
        dashboardUrl: '$workerUrl/app',
        botUsername: botUsername,
        domains: <String>[domain],
        claimLink: 'https://t.me/$botUsername?start=claim',
        accountId: accountId,
        zoneId: zoneId,
        kvNamespaceId: kvNamespaceId,
        d1DatabaseId: d1DatabaseId,
      );
      yield ProvisioningUpdate(steps: steps, state: state);
    } on Object catch (error) {
      steps = _setStep(steps, currentStep, ProvisioningStepStatus.failed, error.toString());
      yield ProvisioningUpdate(steps: steps, error: error.toString());
    }
  }


  Future<MobileSetupState> connectExisting(SetupDraft draft) async {
    if (!draft.isControlValid) {
      throw ProvisioningException('Isi Cloudflare email, Global API Key, domain, dan Worker script name untuk control existing. Bot token boleh kosong.');
    }

    final domain = draft.normalizedDomain;
    final scriptName = draft.effectiveScriptName;
    final cf = CloudflareApi(email: draft.cloudflareEmail.trim(), globalApiKey: draft.cloudflareGlobalApiKey.trim());
    final zone = await cf.getActiveZone(domain);
    final zoneId = zone['id']?.toString() ?? '';
    final accountId = (zone['account'] as Map<dynamic, dynamic>?)?['id']?.toString() ?? '';
    if (zoneId.isEmpty || accountId.isEmpty) {
      throw ProvisioningException('Cloudflare zone tidak punya zone/account id.');
    }

    final accountSubdomain = await cf.getAccountWorkersSubdomain(accountId);
    final settings = await cf.getWorkerSettings(accountId, scriptName);
    final bindingIds = _extractWorkerBindingIds(settings);
    final kvNamespaceId = bindingIds['kv'] ?? '';
    final d1DatabaseId = bindingIds['d1'] ?? '';
    if (d1DatabaseId.isEmpty) {
      throw ProvisioningException('Worker "$scriptName" tidak punya D1 binding MAIL_DB. Tidak bisa membuka native inbox.');
    }

    final domains = <String>{domain};
    if (kvNamespaceId.isNotEmpty) {
      final kvRaw = await cf.getKVValue(accountId, kvNamespaceId, 'domains');
      if (kvRaw != null && kvRaw.trim().isNotEmpty) {
        try {
          final parsed = jsonDecode(kvRaw);
          if (parsed is List<dynamic>) {
            for (final value in parsed) {
              final normalized = InputValidators.normalizeDomain(value.toString());
              if (normalized.isNotEmpty) domains.add(normalized);
            }
          }
        } on Object {
          // Keep primary domain only if remote KV is malformed.
        }
      }
    }

    var botUsername = '';
    if (InputValidators.isTelegramBotToken(draft.telegramBotToken)) {
      try {
        final bot = await TelegramApi(draft.telegramBotToken.trim()).getMe();
        botUsername = bot['username']?.toString() ?? '';
      } on Object {
        botUsername = '';
      }
    }

    final workerUrl = 'https://$scriptName.$accountSubdomain.workers.dev';
    final orderedDomains = domains.toList(growable: false)..sort();
    orderedDomains.remove(domain);
    orderedDomains.insert(0, domain);
    return MobileSetupState(
      primaryDomain: domain,
      scriptName: scriptName,
      workerUrl: workerUrl,
      dashboardUrl: '$workerUrl/app',
      botUsername: botUsername,
      domains: orderedDomains,
      claimLink: botUsername.isEmpty ? '' : 'https://t.me/$botUsername?start=claim',
      accountId: accountId,
      zoneId: zoneId,
      kvNamespaceId: kvNamespaceId,
      d1DatabaseId: d1DatabaseId,
    );
  }


  Future<MobileSetupState> addDomain({
    required SetupDraft draft,
    required MobileSetupState state,
    required String domain,
    bool force = false,
  }) async {
    final newDomain = InputValidators.normalizeDomain(domain);
    if (!InputValidators.isDomain(newDomain)) {
      throw ProvisioningException('Domain tambahan tidak valid: $domain');
    }
    if (state.accountId.isEmpty || state.scriptName.isEmpty) {
      throw ProvisioningException('Setup state belum lengkap. Jalankan setup utama dulu.');
    }

    final cf = CloudflareApi(email: draft.cloudflareEmail.trim(), globalApiKey: draft.cloudflareGlobalApiKey.trim());
    final zone = await cf.getActiveZone(newDomain);
    final zoneId = zone['id']?.toString() ?? '';
    final zoneAccountId = (zone['account'] as Map<dynamic, dynamic>?)?['id']?.toString() ?? '';
    if (zoneId.isEmpty || zoneAccountId.isEmpty) {
      throw ProvisioningException('Cloudflare zone tambahan tidak punya zone/account id.');
    }
    if (zoneAccountId != state.accountId) {
      throw ProvisioningException('Domain $newDomain ada di akun Cloudflare berbeda. Gunakan akun yang sama dengan ${state.primaryDomain}.');
    }

    String namespaceId = state.kvNamespaceId;
    if (namespaceId.isEmpty) {
      final settings = await cf.getWorkerSettings(state.accountId, state.scriptName);
      final bindings = settings['bindings'];
      if (bindings is List<dynamic>) {
        for (final binding in bindings) {
          final item = Map<String, dynamic>.from(binding as Map<dynamic, dynamic>);
          if (item['type'] == 'kv_namespace' && item['name'] == 'STATE_KV') {
            namespaceId = item['namespace_id']?.toString() ?? '';
          }
        }
      }
    }
    if (namespaceId.isEmpty) {
      throw ProvisioningException('STATE_KV binding tidak ditemukan; tidak bisa menyimpan daftar domain.');
    }

    final catchAll = await cf.getCatchAllRule(zoneId);
    final existingTarget = normalizeCatchAllTarget(catchAll);
    if (existingTarget.isNotEmpty && existingTarget != state.scriptName && !force) {
      throw ProvisioningException('Catch-all $newDomain sudah mengarah ke Worker "$existingTarget". Aktifkan force hanya untuk domain test/kosong.');
    }

    try {
      await cf.enableEmailRoutingDns(zoneId);
    } on CloudflareApiException catch (error) {
      if (!error.hasCode(2008) || !force) rethrow;
      await cf.deleteNonCloudflareMxRecords(zoneId);
      await cf.enableEmailRoutingDns(zoneId);
    }
    await cf.setCatchAllWorker(zoneId, state.scriptName);

    final kvRaw = await cf.getKVValue(state.accountId, namespaceId, 'domains');
    final domains = <String>{...state.domains.map(InputValidators.normalizeDomain)};
    if (kvRaw != null && kvRaw.trim().isNotEmpty) {
      try {
        final parsed = jsonDecode(kvRaw);
        if (parsed is List<dynamic>) {
          for (final value in parsed) {
            final normalized = InputValidators.normalizeDomain(value.toString());
            if (normalized.isNotEmpty) domains.add(normalized);
          }
        }
      } on Object {
        // Keep local state domains if remote KV is malformed.
      }
    }
    domains.add(newDomain);
    final orderedDomains = domains.where((value) => value.isNotEmpty).toList(growable: false)..sort();
    orderedDomains.remove(state.primaryDomain);
    orderedDomains.insert(0, state.primaryDomain);
    await cf.putKVValue(state.accountId, namespaceId, 'domains', jsonEncode(orderedDomains));

    return state.copyWith(
      domains: orderedDomains,
      kvNamespaceId: namespaceId,
    );
  }

  static Map<String, String> _extractWorkerBindingIds(Map<String, dynamic> settings) {
    final result = <String, String>{};
    final bindings = settings['bindings'];
    if (bindings is! List<dynamic>) return result;
    for (final binding in bindings) {
      if (binding is! Map<dynamic, dynamic>) continue;
      final item = Map<String, dynamic>.from(binding);
      final name = item['name']?.toString() ?? '';
      final type = item['type']?.toString() ?? '';
      if (type == 'kv_namespace' && name == 'STATE_KV') {
        result['kv'] = item['namespace_id']?.toString() ?? '';
      }
      if ((type == 'd1' || type == 'd1_database') && name == 'MAIL_DB') {
        result['d1'] = (item['database_id'] ?? item['id'])?.toString() ?? '';
      }
    }
    return result;
  }

  static String normalizeCatchAllTarget(Map<String, dynamic> catchAll) {
    final actions = catchAll['actions'];
    if (actions is! List<dynamic>) return '';
    for (final action in actions) {
      final item = Map<String, dynamic>.from(action as Map<dynamic, dynamic>);
      if (item['type'] != 'worker') continue;
      final value = item['value'];
      if (value is List<dynamic> && value.isNotEmpty) return value.first.toString();
    }
    return '';
  }

  static List<ProvisioningStep> _setStep(
    List<ProvisioningStep> steps,
    String id,
    ProvisioningStepStatus status,
    String detail,
  ) {
    return steps
        .map((step) => step.id == id ? step.copyWith(status: status, detail: detail) : step)
        .toList(growable: false);
  }

  static String _randomToken(int length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    final random = Random.secure();
    return List<String>.generate(length, (_) => chars[random.nextInt(chars.length)]).join();
  }
}

class ProvisioningUpdate {
  const ProvisioningUpdate({required this.steps, this.state, this.error});

  final List<ProvisioningStep> steps;
  final MobileSetupState? state;
  final String? error;
}

class ProvisioningException implements Exception {
  ProvisioningException(this.message);
  final String message;

  @override
  String toString() => message;
}
