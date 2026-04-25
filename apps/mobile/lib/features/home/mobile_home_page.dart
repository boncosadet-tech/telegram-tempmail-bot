import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show rootBundle;

import '../../core/models/setup_models.dart';
import '../../core/theme/app_design.dart';
import '../../core/widgets/app_components.dart';
import '../../core/validators/input_validators.dart';
import 'inbox_panel.dart';
import '../../services/native_actions.dart';
import '../../services/otp_autofill_service.dart';
import '../../services/provisioning_service.dart';
import '../../services/secure_config_store.dart';
import '../../services/toast_service.dart';

class MobileHomePage extends StatefulWidget {
  const MobileHomePage({super.key});

  @override
  State<MobileHomePage> createState() => _MobileHomePageState();
}

class _MobileHomePageState extends State<MobileHomePage> {
  final ProvisioningService _provisioning = const ProvisioningService();
  final SecureConfigStore _secureStore = const SecureConfigStore();
  final ToastService _toast = const ToastService();
  late final OtpAutofillService _otpService;
  final TextEditingController _emailController = TextEditingController();
  final TextEditingController _globalKeyController = TextEditingController();
  final TextEditingController _botTokenController = TextEditingController();
  final TextEditingController _domainController =
      TextEditingController(text: 'dahus.my.id');
  final TextEditingController _scriptController =
      TextEditingController(text: 'telegram-tempmail');

  bool _saveCredentials = false;
  bool _replaceExistingMxRecords = false;
  bool _hideSecrets = true;
  bool _addingDomain = false;
  bool _connectingExisting = false;
  bool _restoringState = true;
  StoredCredentials? _storedCredentials;
  int _page = 0;
  List<ProvisioningStep> _steps = const ProvisioningService().initialSteps();
  MobileSetupState? _setupState;

  @override
  void initState() {
    super.initState();
    _otpService = OtpAutofillService(toast: _toast);
    _restoreSavedState();
    _otpService.startListening();
  }

  @override
  void dispose() {
    _otpService.dispose();
    _emailController.dispose();
    _globalKeyController.dispose();
    _botTokenController.dispose();
    _domainController.dispose();
    _scriptController.dispose();
    super.dispose();
  }

  SetupDraft get _draft => SetupDraft(
        cloudflareEmail: _emailController.text,
        cloudflareGlobalApiKey: _globalKeyController.text,
        telegramBotToken: _botTokenController.text,
        domain: _domainController.text,
        scriptName: _scriptController.text,
        saveCredentials: _saveCredentials,
        replaceExistingMxRecords: _replaceExistingMxRecords,
      );

  void _go(int page) {
    setState(() => _page = page);
  }

  Future<void> _restoreSavedState() async {
    try {
      final state = await _secureStore.readSetupState();
      final credentials = await _secureStore.readCredentials();
      if (!mounted) return;
      if (state != null) {
        setState(() {
          _setupState = state;
          _storedCredentials = credentials;
          _domainController.text = state.primaryDomain;
          _scriptController.text = state.scriptName;
          if (credentials != null) {
            _emailController.text = credentials.cloudflareEmail;
            _globalKeyController.text = credentials.cloudflareGlobalApiKey;
            _botTokenController.text = credentials.telegramBotToken;
            _saveCredentials = true;
          }
          _page = 3;
        });
      }
    } on Object catch (error) {
      debugPrint('restore setup state failed: $error');
    } finally {
      if (mounted) setState(() => _restoringState = false);
    }
  }

  Future<void> _runSetup() async {
    if (!_draft.isValid) {
      _showSnack(
          'Form belum valid. Cek email, API key, bot token, dan domain.');
      return;
    }
    setState(() => _steps = _provisioning.initialSteps());
    _go(2);
    final workerSource = await rootBundle.loadString('assets/worker/main.js');
    String? error;
    await for (final update
        in _provisioning.runSetup(_draft, workerSource: workerSource)) {
      if (!mounted) return;
      setState(() {
        _steps = update.steps;
        if (update.state != null) _setupState = update.state;
      });
      error = update.error;
      if (update.state != null) {
        await _persistSetupState(update.state!);
        await Future<void>.delayed(const Duration(milliseconds: 450));
        if (!mounted) return;
        _go(3);
      }
    }
    if (!mounted) return;
    if (error != null) {
      _showSnack('Setup gagal. Buka detail error di step merah.');
      return;
    }
    _showSnack('Setup selesai. Buka claim link di Telegram.');
    if (_setupState != null) _go(3);
  }

  Future<void> _persistSetupState(MobileSetupState state) async {
    await _secureStore.saveSetupState(state);
    if (_draft.saveCredentials) {
      await _secureStore.saveCredentials(_draft);
      _storedCredentials = StoredCredentials(
        cloudflareEmail: _draft.cloudflareEmail.trim(),
        cloudflareGlobalApiKey: _draft.cloudflareGlobalApiKey.trim(),
        telegramBotToken: _draft.telegramBotToken.trim(),
      );
    } else {
      await _secureStore.clearCredentials();
      _storedCredentials = null;
    }
  }

  Future<void> _openUrl(String url) async {
    try {
      await NativeActions.openUrl(url);
    } on Object catch (error) {
      _showSnack('Tidak bisa membuka link: $error');
    }
  }

  Future<void> _copyText(String text) async {
    try {
      await NativeActions.copyText(text);
      await _toast.copied();
    } on Object catch (error) {
      await _toast.error('Tidak bisa copy: $error');
    }
  }

  Future<void> _controlExisting() async {
    if (!_draft.isControlValid) {
      _showSnack(
          'Control existing butuh Cloudflare email, Global API Key, domain, dan script name. Bot token boleh kosong.');
      return;
    }
    setState(() => _connectingExisting = true);
    try {
      final state = await _provisioning.connectExisting(_draft);
      await _secureStore.saveSetupState(state);
      await _secureStore.saveCredentials(_draft);
      if (!mounted) return;
      setState(() {
        _setupState = state;
        _storedCredentials = StoredCredentials(
          cloudflareEmail: _draft.cloudflareEmail.trim(),
          cloudflareGlobalApiKey: _draft.cloudflareGlobalApiKey.trim(),
          telegramBotToken: _draft.telegramBotToken.trim(),
        );
        _saveCredentials = true;
      });
      _showSnack(
          'Connected. App sekarang kontrol deployment existing tanpa redeploy.');
      _go(3);
    } on Object catch (error) {
      if (!mounted) return;
      _showSnack('Control existing gagal. ${humanizeError(error.toString())}');
    } finally {
      if (mounted) setState(() => _connectingExisting = false);
    }
  }

  Future<void> _saveCurrentCredentials() async {
    if (!_draft.isValid) {
      _showSnack(
          'Credential belum valid. Isi email Cloudflare, Global API Key, bot token, domain, dan script name.');
      _go(1);
      return;
    }
    await _secureStore.saveCredentials(_draft);
    setState(() {
      _storedCredentials = StoredCredentials(
        cloudflareEmail: _draft.cloudflareEmail.trim(),
        cloudflareGlobalApiKey: _draft.cloudflareGlobalApiKey.trim(),
        telegramBotToken: _draft.telegramBotToken.trim(),
      );
      _saveCredentials = true;
    });
    _showSnack('Credential terenkripsi disimpan di device.');
  }

  Future<void> _addDomain(String domain, bool force) async {
    final state = _setupState;
    if (state == null) {
      _showSnack('Setup utama belum selesai.');
      return;
    }
    setState(() => _addingDomain = true);
    try {
      final next = await _provisioning.addDomain(
        draft: _draft,
        state: state,
        domain: domain,
        force: force,
      );
      await _secureStore.saveSetupState(next);
      if (!mounted) return;
      setState(() => _setupState = next);
      _showSnack(
          'Domain ${InputValidators.normalizeDomain(domain)} berhasil ditambahkan.');
      _go(3);
    } on Object catch (error) {
      if (!mounted) return;
      _showSnack('Add domain gagal. ${humanizeError(error.toString())}');
    } finally {
      if (mounted) setState(() => _addingDomain = false);
    }
  }

  void _showSnack(String message) {
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    if (_restoringState) {
      return const Scaffold(
        body: SafeArea(
          child: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                SizedBox(
                  width: 28,
                  height: 28,
                  child: CircularProgressIndicator(
                    strokeWidth: 2.5,
                    color: AppColors.primary,
                  ),
                ),
                SizedBox(height: 16),
                Text('Loading...', style: AppText.caption),
              ],
            ),
          ),
        ),
      );
    }
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: AppSpacing.maxWidth),
            child: Column(
              children: <Widget>[
                _TopBar(page: _page),
                Expanded(
                  child: AnimatedSwitcher(
                    duration: const Duration(milliseconds: 250),
                    switchInCurve: Curves.easeOut,
                    switchOutCurve: Curves.easeIn,
                    transitionBuilder: (child, animation) {
                      return FadeTransition(opacity: animation, child: child);
                    },
                    child: KeyedSubtree(
                      key: ValueKey<int>(_page),
                      child: _buildPage(),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildPage() {
    return switch (_page) {
      0 => _WelcomeStep(onStart: () => _go(1)),
      1 => _CredentialsStep(
          emailController: _emailController,
          globalKeyController: _globalKeyController,
          botTokenController: _botTokenController,
          domainController: _domainController,
          scriptController: _scriptController,
          saveCredentials: _saveCredentials,
          replaceExistingMxRecords: _replaceExistingMxRecords,
          hideSecrets: _hideSecrets,
          onToggleSave: (value) => setState(() => _saveCredentials = value),
          onToggleReplaceMx: (value) =>
              setState(() => _replaceExistingMxRecords = value),
          isConnectingExisting: _connectingExisting,
          onToggleSecretMode: () =>
              setState(() => _hideSecrets = !_hideSecrets),
          onBack: () => _go(0),
          onSubmit: _runSetup,
          onControlExisting: _controlExisting,
        ),
      2 => _ProgressStep(
          steps: _steps,
          onContinue: _setupState == null ? null : () => _go(3),
        ),
      3 => _DashboardStep(
          state: _setupState,
          credentials: _storedCredentials,
          onAddDomain: () => _go(4),
          onReset: () => _go(1),
          onSaveCredentials: _saveCurrentCredentials,
          onOpenUrl: _openUrl,
          onCopyText: _copyText,
        ),
      4 => _AddDomainStep(
          primaryDomain: _setupState?.primaryDomain ?? _draft.normalizedDomain,
          isRunning: _addingDomain,
          onAddDomain: _addDomain,
          onBack: () => _go(3),
        ),
      _ => _WelcomeStep(onStart: () => _go(1)),
    };
  }
}

// ---------------------------------------------------------------------------
// Top bar — ProtonMail-style app bar with purple accent
// ---------------------------------------------------------------------------

class _TopBar extends StatelessWidget {
  const _TopBar({required this.page});

  final int page;

  static const _titles = <String>[
    'Welcome',
    'Configuration',
    'Setup',
    'Dashboard',
    'Add domain'
  ];

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).colorScheme.brightness == Brightness.dark;
    return Container(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.screen, 14, AppSpacing.screen, 12),
      decoration: BoxDecoration(
        color: dark ? AppColors.darkSurface : AppColors.surface,
        boxShadow: const <BoxShadow>[
          BoxShadow(
            color: Color(0x08000000),
            blurRadius: 4,
            offset: Offset(0, 1),
          ),
        ],
      ),
      child: Row(
        children: <Widget>[
          Container(
            width: 32,
            height: 32,
            decoration: const BoxDecoration(
              color: AppColors.primary,
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.mail_rounded,
                color: AppColors.onPrimary, size: 16),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text('Private TempMail',
                    style: AppText.body.copyWith(fontWeight: FontWeight.w700)),
                Text(
                  page < _titles.length ? _titles[page] : '',
                  style: AppText.caption,
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: AppColors.primary.withValues(alpha: .1),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Text('${page + 1}/5',
                style: AppText.caption.copyWith(
                    color: AppColors.primary, fontWeight: FontWeight.w700)),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Screen container
// ---------------------------------------------------------------------------

class _Screen extends StatelessWidget {
  const _Screen({required this.children, this.scroll = false});

  final List<Widget> children;
  final bool scroll;

  @override
  Widget build(BuildContext context) {
    final content = Padding(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.screen, 16, AppSpacing.screen, AppSpacing.screen),
      child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
    );
    return scroll ? SingleChildScrollView(child: content) : content;
  }
}

// ---------------------------------------------------------------------------
// ProtonMail-style elevated card
// ---------------------------------------------------------------------------

class _AppCard extends StatelessWidget {
  const _AppCard({required this.child, this.accentColor, this.dimmed = false});

  final Widget child;
  final Color? accentColor;
  final bool dimmed;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).colorScheme.brightness == Brightness.dark;
    final surface = dark ? AppColors.darkSurface : AppColors.surface;
    return AnimatedOpacity(
      duration: const Duration(milliseconds: 200),
      opacity: dimmed ? .5 : 1,
      child: Container(
        margin: const EdgeInsets.only(bottom: AppSpacing.section),
        decoration: BoxDecoration(
          color: surface,
          borderRadius: BorderRadius.circular(AppSpacing.radius),
          boxShadow: AppShadows.card,
        ),
        clipBehavior: Clip.antiAlias,
        child: Stack(
          children: <Widget>[
            if (accentColor != null)
              Positioned(
                left: 0,
                top: 0,
                bottom: 0,
                width: 4,
                child: ColoredBox(color: accentColor!),
              ),
            Padding(
              padding: EdgeInsets.fromLTRB(
                AppSpacing.card + (accentColor == null ? 0 : 4),
                AppSpacing.card,
                AppSpacing.card,
                AppSpacing.card,
              ),
              child: child,
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Page 0 — Welcome (ProtonMail-style landing)
// ---------------------------------------------------------------------------

class _WelcomeStep extends StatelessWidget {
  const _WelcomeStep({required this.onStart});

  final VoidCallback onStart;

  @override
  Widget build(BuildContext context) {
    return _Screen(
      scroll: true,
      children: <Widget>[
        const SizedBox(height: 28),
        Center(
          child: Container(
            width: 64,
            height: 64,
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: <Color>[AppColors.primary, AppColors.primaryVariant],
              ),
              shape: BoxShape.circle,
              boxShadow: <BoxShadow>[
                BoxShadow(
                  color: AppColors.primary.withValues(alpha: .3),
                  blurRadius: 20,
                  offset: const Offset(0, 6),
                ),
              ],
            ),
            child: const Icon(Icons.mail_rounded,
                color: AppColors.onPrimary, size: 30),
          ),
        ),
        const SizedBox(height: 20),
        const Text('Private TempMail',
            textAlign: TextAlign.center, style: AppText.h1),
        const SizedBox(height: 8),
        Text(
          'Disposable email powered by Cloudflare Workers + Telegram. No server required after setup.',
          textAlign: TextAlign.center,
          style: AppText.body.copyWith(color: AppColors.textSecondary),
        ),
        const SizedBox(height: 28),
        FilledButton(
          onPressed: onStart,
          child: const Text('Get Started'),
        ),
        const SizedBox(height: 10),
        OutlinedButton(
          onPressed: onStart,
          child: const Text('Open Configuration'),
        ),
        const SizedBox(height: 28),
        const _FeatureList(items: <String>[
          'Cloudflare Free compatible',
          'No local server after setup',
          'Multi-domain temp mail routing',
          'Telegram bot + web dashboard',
        ]),
      ],
    );
  }
}

class _FeatureList extends StatelessWidget {
  const _FeatureList({required this.items});

  final List<String> items;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).colorScheme.brightness == Brightness.dark;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: dark ? AppColors.darkSurface : AppColors.surface,
        borderRadius: BorderRadius.circular(AppSpacing.radius),
        boxShadow: AppShadows.card,
      ),
      child: Column(
        children: <Widget>[
          for (final item in items)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Container(
                    width: 22,
                    height: 22,
                    decoration: BoxDecoration(
                      color: AppColors.success.withValues(alpha: .1),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(Icons.check_rounded,
                        color: AppColors.success, size: 14),
                  ),
                  const SizedBox(width: 10),
                  Expanded(child: Text(item, style: AppText.body)),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Page 1 — Credentials (ProtonMail-style form)
// ---------------------------------------------------------------------------

class _CredentialsStep extends StatelessWidget {
  const _CredentialsStep({
    required this.emailController,
    required this.globalKeyController,
    required this.botTokenController,
    required this.domainController,
    required this.scriptController,
    required this.saveCredentials,
    required this.replaceExistingMxRecords,
    required this.hideSecrets,
    required this.isConnectingExisting,
    required this.onToggleSave,
    required this.onToggleReplaceMx,
    required this.onToggleSecretMode,
    required this.onBack,
    required this.onSubmit,
    required this.onControlExisting,
  });

  final TextEditingController emailController;
  final TextEditingController globalKeyController;
  final TextEditingController botTokenController;
  final TextEditingController domainController;
  final TextEditingController scriptController;
  final bool saveCredentials;
  final bool replaceExistingMxRecords;
  final bool hideSecrets;
  final bool isConnectingExisting;
  final ValueChanged<bool> onToggleSave;
  final ValueChanged<bool> onToggleReplaceMx;
  final VoidCallback onToggleSecretMode;
  final VoidCallback onBack;
  final VoidCallback onSubmit;
  final VoidCallback onControlExisting;

  @override
  Widget build(BuildContext context) {
    return _Screen(
      scroll: true,
      children: <Widget>[
        const Text('Configuration', style: AppText.h1),
        const SizedBox(height: 6),
        const Text('Choose a setup mode, then fill in your credentials below.',
            style: AppText.caption),
        const SizedBox(height: 20),
        Row(
          children: <Widget>[
            Expanded(
              child: _SetupModeCard(
                icon: Icons.rocket_launch_rounded,
                title: 'Deploy',
                subtitle: 'Full setup',
                color: AppColors.primary,
                onTap: onSubmit,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _SetupModeCard(
                icon: Icons.login_rounded,
                title: isConnectingExisting ? 'Connecting...' : 'Control',
                subtitle: 'Existing setup',
                color: AppColors.info,
                onTap: isConnectingExisting ? null : onControlExisting,
              ),
            ),
          ],
        ),
        const SizedBox(height: 20),
        const _SectionLabel(label: 'CREDENTIALS'),
        const SizedBox(height: 10),
        _Field(
          controller: emailController,
          label: 'Cloudflare email',
          helper: 'Your Cloudflare account email.',
          icon: Icons.alternate_email,
          validator: InputValidators.isCloudflareEmail,
        ),
        _Field(
          controller: globalKeyController,
          label: 'Cloudflare Global API Key',
          helper: 'Stored encrypted if toggle is on.',
          icon: Icons.key_rounded,
          obscure: hideSecrets,
          validator: InputValidators.isGlobalApiKey,
        ),
        _Field(
          controller: botTokenController,
          label: 'Telegram Bot Token',
          helper: 'Required for Deploy. Optional for Control Existing.',
          icon: Icons.smart_toy_rounded,
          obscure: hideSecrets,
          validator: (value) =>
              value.trim().isEmpty || InputValidators.isTelegramBotToken(value),
        ),
        const SizedBox(height: 4),
        const _SectionLabel(label: 'DEPLOYMENT TARGET'),
        const SizedBox(height: 10),
        _Field(
          controller: domainController,
          label: 'Primary domain',
          helper: 'Must be Active on Cloudflare.',
          icon: Icons.language_rounded,
          validator: InputValidators.isDomain,
        ),
        _Field(
          controller: scriptController,
          label: 'Worker script name',
          helper: 'Default: telegram-tempmail.',
          icon: Icons.cloud_outlined,
          validator: (value) => InputValidators.isScriptName(
              InputValidators.normalizeScriptName(
                  value, domainController.text)),
        ),
        const SizedBox(height: 4),
        const _SectionLabel(label: 'OPTIONS'),
        const SizedBox(height: 10),
        _OptionToggle(
          value: saveCredentials,
          onChanged: onToggleSave,
          title: 'Save credentials on device',
          subtitle: 'Encrypted via Android Keystore for native inbox.',
        ),
        _OptionToggle(
          value: replaceExistingMxRecords,
          onChanged: onToggleReplaceMx,
          title: 'Replace existing MX records',
          subtitle: 'Only enable for test/empty domains.',
        ),
        const SizedBox(height: 4),
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(
            onPressed: onToggleSecretMode,
            icon: Icon(
                hideSecrets
                    ? Icons.visibility_outlined
                    : Icons.visibility_off_outlined,
                size: 18),
            label: Text(hideSecrets ? 'Show secrets' : 'Hide secrets',
                style: AppText.caption.copyWith(color: AppColors.primary)),
          ),
        ),
        const SizedBox(height: 8),
        OutlinedButton(onPressed: onBack, child: const Text('Back')),
      ],
    );
  }
}

class _SetupModeCard extends StatelessWidget {
  const _SetupModeCard(
      {required this.icon,
      required this.title,
      required this.subtitle,
      required this.color,
      required this.onTap});

  final IconData icon;
  final String title;
  final String subtitle;
  final Color color;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).colorScheme.brightness == Brightness.dark;
    return Material(
      color: dark ? AppColors.darkSurface : AppColors.surface,
      borderRadius: BorderRadius.circular(AppSpacing.radius),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppSpacing.radius),
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AppSpacing.radius),
            boxShadow: AppShadows.card,
          ),
          child: Column(
            children: <Widget>[
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: .1),
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, color: color, size: 22),
              ),
              const SizedBox(height: 10),
              Text(title,
                  style: AppText.body.copyWith(fontWeight: FontWeight.w700)),
              const SizedBox(height: 2),
              Text(subtitle, style: AppText.caption),
            ],
          ),
        ),
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Text(label, style: AppText.label.copyWith(color: AppColors.primary));
  }
}

class _OptionToggle extends StatelessWidget {
  const _OptionToggle(
      {required this.value,
      required this.onChanged,
      required this.title,
      required this.subtitle});

  final bool value;
  final ValueChanged<bool>? onChanged;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).colorScheme.brightness == Brightness.dark;
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: dark ? AppColors.darkSurface : AppColors.surface,
        borderRadius: BorderRadius.circular(AppSpacing.radius),
        boxShadow: AppShadows.card,
      ),
      child: SwitchListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 2),
        value: value,
        onChanged: onChanged,
        title: Text(title,
            style: AppText.body.copyWith(fontWeight: FontWeight.w600)),
        subtitle: Text(subtitle, style: AppText.caption),
        shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppSpacing.radius)),
      ),
    );
  }
}

class _Field extends StatefulWidget {
  const _Field({
    required this.controller,
    required this.label,
    required this.helper,
    required this.icon,
    required this.validator,
    this.obscure = false,
  });

  final TextEditingController controller;
  final String label;
  final String helper;
  final IconData icon;
  final bool obscure;
  final bool Function(String value) validator;

  @override
  State<_Field> createState() => _FieldState();
}

class _FieldState extends State<_Field> {
  bool _touched = false;

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_refresh);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_refresh);
    super.dispose();
  }

  void _refresh() {
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final value = widget.controller.text;
    final valid = widget.validator(value);
    final showError = _touched && value.isNotEmpty && !valid;
    final showOk = value.isNotEmpty && valid;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextField(
        controller: widget.controller,
        obscureText: widget.obscure,
        minLines: 1,
        onChanged: (_) => setState(() => _touched = true),
        decoration: InputDecoration(
          prefixIcon: Icon(widget.icon, size: 20),
          suffixIcon: showOk
              ? const Icon(Icons.check_circle_rounded,
                  color: AppColors.success, size: 20)
              : showError
                  ? const Icon(Icons.error_rounded,
                      color: AppColors.error, size: 20)
                  : null,
          labelText: widget.label,
          helperText: widget.helper,
          errorText: showError ? 'Format belum valid' : null,
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Page 2 — Progress (ProtonMail-style step list)
// ---------------------------------------------------------------------------

class _ProgressStep extends StatelessWidget {
  const _ProgressStep({required this.steps, required this.onContinue});

  final List<ProvisioningStep> steps;
  final VoidCallback? onContinue;

  @override
  Widget build(BuildContext context) {
    final completed =
        steps.where((step) => step.status == ProvisioningStepStatus.ok).length;
    final failed =
        steps.any((step) => step.status == ProvisioningStepStatus.failed);
    return _Screen(
      scroll: true,
      children: <Widget>[
        const Text('Setup', style: AppText.h1),
        const SizedBox(height: 6),
        Text('$completed of ${steps.length} steps complete',
            style: AppText.caption),
        const SizedBox(height: 14),
        ClipRRect(
          borderRadius: BorderRadius.circular(6),
          child: LinearProgressIndicator(
            value: completed / max(steps.length, 1),
            minHeight: 6,
            color: failed ? AppColors.error : AppColors.primary,
            backgroundColor: AppColors.primary.withValues(alpha: .12),
          ),
        ),
        const SizedBox(height: 18),
        for (final step in steps) _StepTile(step: step),
        if (onContinue != null) ...<Widget>[
          const SizedBox(height: 8),
          FilledButton(
            onPressed: onContinue,
            child: const Text('Open Dashboard'),
          ),
        ],
      ],
    );
  }
}

class _StepTile extends StatefulWidget {
  const _StepTile({required this.step});

  final ProvisioningStep step;

  @override
  State<_StepTile> createState() => _StepTileState();
}

class _StepTileState extends State<_StepTile>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 900),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final step = widget.step;
    final color = statusColor(step.status);
    final running = step.status == ProvisioningStepStatus.running;
    final failed = step.status == ProvisioningStepStatus.failed;
    final icon = switch (step.status) {
      ProvisioningStepStatus.ok => Icons.check_circle_rounded,
      ProvisioningStepStatus.failed => Icons.cancel_rounded,
      ProvisioningStepStatus.running => Icons.sync_rounded,
      _ => Icons.circle_outlined,
    };
    final body = Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        running
            ? SizedBox(
                width: 20,
                height: 20,
                child:
                    CircularProgressIndicator(strokeWidth: 2.5, color: color))
            : Icon(icon, color: color, size: 20),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(step.title,
                  style: AppText.body.copyWith(fontWeight: FontWeight.w600)),
              if (step.detail.isNotEmpty) ...<Widget>[
                const SizedBox(height: 3),
                Text(humanizeError(step.detail),
                    style: failed
                        ? AppText.caption.copyWith(color: AppColors.error)
                        : AppText.caption),
              ],
              if (failed && step.detail.isNotEmpty) ...<Widget>[
                const SizedBox(height: 6),
                Theme(
                  data: Theme.of(context)
                      .copyWith(dividerColor: Colors.transparent),
                  child: ExpansionTile(
                    tilePadding: EdgeInsets.zero,
                    childrenPadding: EdgeInsets.zero,
                    title: Text('Show details',
                        style: AppText.caption
                            .copyWith(fontWeight: FontWeight.w600)),
                    children: <Widget>[
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: AppColors.error.withValues(alpha: .05),
                          borderRadius:
                              BorderRadius.circular(AppSpacing.radius),
                        ),
                        child: Text(step.detail, style: AppText.mono),
                      ),
                    ],
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    );
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        return _AppCard(
          accentColor: color,
          dimmed: step.status == ProvisioningStepStatus.pending,
          child: running
              ? Opacity(
                  opacity: .85 + (_controller.value * .15),
                  child: child,
                )
              : child!,
        );
      },
      child: body,
    );
  }
}

// ---------------------------------------------------------------------------
// Page 3 — Dashboard (Gmail/ProtonMail-style segmented tabs)
// ---------------------------------------------------------------------------

enum _DashboardSection { overview, inbox, addresses, manage }

class _DashboardStep extends StatefulWidget {
  const _DashboardStep({
    required this.state,
    required this.credentials,
    required this.onAddDomain,
    required this.onReset,
    required this.onSaveCredentials,
    required this.onOpenUrl,
    required this.onCopyText,
  });

  final MobileSetupState? state;
  final StoredCredentials? credentials;
  final VoidCallback onAddDomain;
  final VoidCallback onReset;
  final VoidCallback onSaveCredentials;
  final ValueChanged<String> onOpenUrl;
  final ValueChanged<String> onCopyText;

  @override
  State<_DashboardStep> createState() => _DashboardStepState();
}

class _DashboardStepState extends State<_DashboardStep> {
  _DashboardSection _section = _DashboardSection.overview;

  @override
  Widget build(BuildContext context) {
    final current = widget.state;
    return _Screen(
      scroll: true,
      children: <Widget>[
        const Text('Dashboard', style: AppText.h1),
        const SizedBox(height: 10),
        if (current == null)
          _AppCard(
            accentColor: AppColors.warning,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text('No setup state found',
                    style: AppText.body.copyWith(fontWeight: FontWeight.w600)),
                const SizedBox(height: 4),
                const Text('Run deploy or control existing to start.',
                    style: AppText.caption),
                const SizedBox(height: 12),
                FilledButton(
                    onPressed: widget.onReset, child: const Text('Open setup')),
              ],
            ),
          )
        else ...<Widget>[
          _DashboardTabBar(
              value: _section,
              onChanged: (value) => setState(() => _section = value)),
          const SizedBox(height: AppSpacing.section),
          switch (_section) {
            _DashboardSection.overview => Column(children: <Widget>[
                _SummaryCard(
                    state: current,
                    credentials: widget.credentials,
                    onOpenUrl: widget.onOpenUrl,
                    onCopyText: widget.onCopyText),
                _QuickActionsCard(
                    current: current,
                    onAddDomain: widget.onAddDomain,
                    onReset: widget.onReset,
                    onOpenUrl: widget.onOpenUrl)
              ]),
            _DashboardSection.inbox => _InboxCard(
                state: current,
                credentials: widget.credentials,
                onOpenUrl: widget.onOpenUrl,
                onCopyText: widget.onCopyText,
                onSaveCredentials: widget.onSaveCredentials),
            _DashboardSection.addresses => _AddressManagerCard(
                state: current, onCopyText: widget.onCopyText),
            _DashboardSection.manage => _ManageCard(
                current: current,
                onAddDomain: widget.onAddDomain,
                onReset: widget.onReset,
                onOpenUrl: widget.onOpenUrl,
                onCopyText: widget.onCopyText),
          },
        ],
      ],
    );
  }
}

// Gmail/ProtonMail-style pill segmented tab bar
class _DashboardTabBar extends StatelessWidget {
  const _DashboardTabBar({required this.value, required this.onChanged});

  final _DashboardSection value;
  final ValueChanged<_DashboardSection> onChanged;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).colorScheme.brightness == Brightness.dark;
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: dark ? AppColors.darkSurfaceVariant : AppColors.hover,
        borderRadius: BorderRadius.circular(AppSpacing.radius),
      ),
      child: Row(
        children: <Widget>[
          _TabButton(
              label: 'Overview',
              selected: value == _DashboardSection.overview,
              onTap: () => onChanged(_DashboardSection.overview)),
          _TabButton(
              label: 'Inbox',
              selected: value == _DashboardSection.inbox,
              onTap: () => onChanged(_DashboardSection.inbox)),
          _TabButton(
              label: 'Addresses',
              selected: value == _DashboardSection.addresses,
              onTap: () => onChanged(_DashboardSection.addresses)),
          _TabButton(
              label: 'Manage',
              selected: value == _DashboardSection.manage,
              onTap: () => onChanged(_DashboardSection.manage)),
        ],
      ),
    );
  }
}

class _TabButton extends StatelessWidget {
  const _TabButton(
      {required this.label, required this.selected, required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).colorScheme.brightness == Brightness.dark;
    return Expanded(
      child: GestureDetector(
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: const EdgeInsets.symmetric(vertical: 8),
          decoration: BoxDecoration(
            color: selected
                ? (dark ? AppColors.darkSurface : AppColors.surface)
                : Colors.transparent,
            borderRadius: BorderRadius.circular(8),
            boxShadow: selected ? AppShadows.card : null,
          ),
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: AppText.caption.copyWith(
              color: selected
                  ? (dark ? AppColors.darkText : AppColors.textPrimary)
                  : (dark
                      ? AppColors.darkTextSecondary
                      : AppColors.textSecondary),
              fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
            ),
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Dashboard cards
// ---------------------------------------------------------------------------

class _QuickActionsCard extends StatelessWidget {
  const _QuickActionsCard(
      {required this.current,
      required this.onAddDomain,
      required this.onReset,
      required this.onOpenUrl});

  final MobileSetupState current;
  final VoidCallback onAddDomain;
  final VoidCallback onReset;
  final ValueChanged<String> onOpenUrl;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        const _SectionLabel(label: 'QUICK ACTIONS'),
        const SizedBox(height: 10),
        AppActionTile(
            icon: Icons.smart_toy_outlined,
            title: 'Open Telegram bot',
            subtitle: current.botUsername.isEmpty
                ? 'Bot username unavailable'
                : '@${current.botUsername}',
            onTap: current.claimLink.isEmpty
                ? null
                : () => onOpenUrl(current.claimLink),
            color: AppColors.primary),
        const SizedBox(height: 8),
        AppActionTile(
            icon: Icons.open_in_browser_rounded,
            title: 'Open web dashboard',
            subtitle: current.dashboardUrl,
            onTap: () => onOpenUrl(current.dashboardUrl),
            color: AppColors.success),
        const SizedBox(height: 8),
        AppActionTile(
            icon: Icons.add_link_rounded,
            title: 'Add domain',
            subtitle: 'Connect another Cloudflare domain.',
            onTap: onAddDomain,
            color: AppColors.info),
        const SizedBox(height: 8),
        AppActionTile(
            icon: Icons.settings_outlined,
            title: 'Edit setup',
            subtitle: 'Change credentials or deploy mode.',
            onTap: onReset,
            color: AppColors.textSecondary),
      ],
    );
  }
}

class _ManageCard extends StatelessWidget {
  const _ManageCard(
      {required this.current,
      required this.onAddDomain,
      required this.onReset,
      required this.onOpenUrl,
      required this.onCopyText});

  final MobileSetupState current;
  final VoidCallback onAddDomain;
  final VoidCallback onReset;
  final ValueChanged<String> onOpenUrl;
  final ValueChanged<String> onCopyText;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        AppKeyValueGrid(items: <AppKeyValueItem>[
          AppKeyValueItem(label: 'Worker', value: current.scriptName),
          AppKeyValueItem(
              label: 'Primary domain', value: current.primaryDomain),
          AppKeyValueItem(
              label: 'Domains', value: current.domains.length.toString()),
          AppKeyValueItem(
              label: 'D1 inbox',
              value: current.d1DatabaseId.isEmpty ? 'Missing' : 'Ready')
        ]),
        const SizedBox(height: 14),
        _CodeBox(value: current.workerUrl),
        const SizedBox(height: 14),
        AppActionTile(
            icon: Icons.add_link_rounded,
            title: 'Add domain',
            subtitle: 'Connect another Cloudflare domain.',
            onTap: onAddDomain,
            color: AppColors.info),
        const SizedBox(height: 8),
        AppActionTile(
            icon: Icons.settings_outlined,
            title: 'Edit setup',
            subtitle: 'Back to deploy/control and credentials.',
            onTap: onReset,
            color: AppColors.textSecondary),
        const SizedBox(height: 8),
        AppActionTile(
            icon: Icons.copy_outlined,
            title: 'Copy worker URL',
            subtitle: current.workerUrl,
            onTap: () => onCopyText(current.workerUrl),
            color: AppColors.primary),
        const SizedBox(height: 8),
        AppActionTile(
            icon: Icons.open_in_browser_rounded,
            title: 'Open web dashboard',
            subtitle: 'Fallback for inbox and full HTML view.',
            onTap: () => onOpenUrl(current.dashboardUrl),
            color: AppColors.success),
      ],
    );
  }
}

class _SummaryCard extends StatelessWidget {
  const _SummaryCard(
      {required this.state,
      required this.credentials,
      required this.onOpenUrl,
      required this.onCopyText});

  final MobileSetupState state;
  final StoredCredentials? credentials;
  final ValueChanged<String> onOpenUrl;
  final ValueChanged<String> onCopyText;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        AppHeroCard(
          icon: Icons.check_circle_outline_rounded,
          title: 'Setup Complete',
          subtitle: '${state.primaryDomain} · ${state.scriptName}',
          chips: <Widget>[
            AppStatusChip(
                text: '${state.domains.length} domain',
                color: AppColors.info,
                icon: Icons.public_rounded),
            AppStatusChip(
                text: credentials == null
                    ? 'Credential needed'
                    : 'Secure storage',
                color:
                    credentials == null ? AppColors.warning : AppColors.success,
                icon: credentials == null
                    ? Icons.lock_open_rounded
                    : Icons.lock_outlined),
          ],
        ),
        const SizedBox(height: 14),
        AppKeyValueGrid(
          items: <AppKeyValueItem>[
            AppKeyValueItem(
                label: 'Primary domain', value: state.primaryDomain),
            AppKeyValueItem(
                label: 'Telegram bot',
                value:
                    state.botUsername.isEmpty ? '-' : '@${state.botUsername}'),
            AppKeyValueItem(label: 'Domains', value: state.domains.join(', ')),
            AppKeyValueItem(
                label: 'D1 inbox',
                value: state.d1DatabaseId.isEmpty ? 'Missing' : 'Ready'),
          ],
        ),
        const SizedBox(height: 12),
        _CodeBox(value: state.workerUrl),
        const SizedBox(height: 12),
        Row(
          children: <Widget>[
            Expanded(
              child: FilledButton(
                onPressed: state.claimLink.isEmpty
                    ? null
                    : () => onOpenUrl(state.claimLink),
                child: const Text('Open Bot'),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: OutlinedButton(
                onPressed: state.claimLink.isEmpty
                    ? null
                    : () => onCopyText(state.claimLink),
                child: const Text('Copy Link'),
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
      ],
    );
  }
}

class _AddressManagerCard extends StatefulWidget {
  const _AddressManagerCard({required this.state, required this.onCopyText});

  final MobileSetupState state;
  final ValueChanged<String> onCopyText;

  @override
  State<_AddressManagerCard> createState() => _AddressManagerCardState();
}

class _AddressManagerCardState extends State<_AddressManagerCard> {
  final TextEditingController _localController =
      TextEditingController(text: 'test');
  late String _domain = widget.state.domains.first;
  String _address = '';

  @override
  void didUpdateWidget(covariant _AddressManagerCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!widget.state.domains.contains(_domain))
      _domain = widget.state.domains.first;
  }

  @override
  void dispose() {
    _localController.dispose();
    super.dispose();
  }

  void _generate({bool random = false}) {
    final local = random
        ? _randomLocal()
        : InputValidators.normalizeScriptName(_localController.text, _domain)
            .replaceFirst(RegExp(r'^telegram-tempmail-'), '');
    if (local.isEmpty) return;
    setState(() => _address = '$local@$_domain');
  }

  String _randomLocal() {
    final words = <String>['amber', 'swift', 'nova', 'quiet', 'river', 'orbit'];
    final random = Random.secure();
    return '${words[random.nextInt(words.length)]}-${words[random.nextInt(words.length)]}-${1000 + random.nextInt(9000)}';
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        const Text('Create temp mail', style: AppText.h2),
        const SizedBox(height: 4),
        const Text(
            'Cloudflare catch-all accepts any alias. Create an address then copy it.',
            style: AppText.caption),
        const SizedBox(height: 14),
        TextField(
          controller: _localController,
          decoration: const InputDecoration(
              prefixIcon: Icon(Icons.alternate_email_rounded, size: 20),
              labelText: 'Alias local-part',
              helperText: 'e.g. tokopedia, login-test, apk01'),
        ),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(
          initialValue: _domain,
          items: widget.state.domains
              .map((domain) => DropdownMenuItem<String>(
                  value: domain, child: Text('@$domain')))
              .toList(growable: false),
          onChanged: (value) => setState(() => _domain = value ?? _domain),
          decoration: const InputDecoration(
              prefixIcon: Icon(Icons.language_rounded, size: 20),
              labelText: 'Domain'),
        ),
        const SizedBox(height: 14),
        Row(
          children: <Widget>[
            Expanded(
                child: FilledButton(
                    onPressed: _generate, child: const Text('Create'))),
            const SizedBox(width: 8),
            Expanded(
                child: OutlinedButton(
                    onPressed: () => _generate(random: true),
                    child: const Text('Random'))),
          ],
        ),
        if (_address.isNotEmpty) ...<Widget>[
          const SizedBox(height: 14),
          _CodeBox(value: _address),
          const SizedBox(height: 10),
          FilledButton(
              onPressed: () => widget.onCopyText(_address),
              child: const Text('Copy temp mail')),
        ],
      ],
    );
  }
}

class _InboxCard extends StatelessWidget {
  const _InboxCard({
    required this.state,
    required this.credentials,
    required this.onOpenUrl,
    required this.onCopyText,
    required this.onSaveCredentials,
  });

  final MobileSetupState state;
  final StoredCredentials? credentials;
  final ValueChanged<String> onOpenUrl;
  final ValueChanged<String> onCopyText;
  final VoidCallback onSaveCredentials;

  @override
  Widget build(BuildContext context) {
    return InboxPanel(
      state: state,
      credentials: credentials,
      onOpenUrl: onOpenUrl,
      onCopyText: onCopyText,
      onSaveCredentials: onSaveCredentials,
    );
  }
}

// ---------------------------------------------------------------------------
// Page 4 — Add domain
// ---------------------------------------------------------------------------

class _AddDomainStep extends StatefulWidget {
  const _AddDomainStep({
    required this.primaryDomain,
    required this.isRunning,
    required this.onAddDomain,
    required this.onBack,
  });

  final String primaryDomain;
  final bool isRunning;
  final void Function(String domain, bool force) onAddDomain;
  final VoidCallback onBack;

  @override
  State<_AddDomainStep> createState() => _AddDomainStepState();
}

class _AddDomainStepState extends State<_AddDomainStep> {
  final TextEditingController _domainController =
      TextEditingController(text: 'excalibur.email');
  bool _force = false;

  @override
  void dispose() {
    _domainController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return _Screen(
      scroll: true,
      children: <Widget>[
        const Text('Add domain', style: AppText.h1),
        const SizedBox(height: 6),
        Text(
            'Domain must be Active on Cloudflare and on the same account as ${widget.primaryDomain}.',
            style: AppText.caption),
        const SizedBox(height: 18),
        TextField(
          controller: _domainController,
          decoration: const InputDecoration(
              prefixIcon: Icon(Icons.add_link_rounded, size: 20),
              labelText: 'Additional domain',
              helperText: 'e.g. excalibur.email'),
        ),
        const SizedBox(height: 10),
        _OptionToggle(
          value: _force,
          onChanged: widget.isRunning
              ? null
              : (value) => setState(() => _force = value),
          title: 'Force replace catch-all / old MX',
          subtitle: 'Only enable for test/empty domains.',
        ),
        const SizedBox(height: 10),
        FilledButton(
          onPressed: widget.isRunning
              ? null
              : () {
                  final domain =
                      InputValidators.normalizeDomain(_domainController.text);
                  final valid = InputValidators.isDomain(domain);
                  if (!valid) {
                    ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Domain tidak valid')));
                    return;
                  }
                  widget.onAddDomain(domain, _force);
                },
          child: widget.isRunning
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(
                      strokeWidth: 2, color: Colors.white))
              : const Text('Add domain now'),
        ),
        const SizedBox(height: 10),
        OutlinedButton(
            onPressed: widget.isRunning ? null : widget.onBack,
            child: const Text('Back')),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Shared small widgets
// ---------------------------------------------------------------------------

class _CodeBox extends StatelessWidget {
  const _CodeBox({required this.value});

  final String value;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).colorScheme.brightness == Brightness.dark;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: dark ? AppColors.darkSurfaceVariant : AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppSpacing.radius),
      ),
      child: SelectableText(value, style: AppText.mono),
    );
  }
}

String humanizeError(String raw) {
  final text = raw.replaceFirst('Exception: ', '');
  if (text.contains('Non-Cloudflare MX records exist') ||
      text.contains('2008')) {
    return 'Domain masih punya MX lama. Aktifkan "Ganti MX lama otomatis" jika domain ini memang untuk tempmail/test.';
  }
  if (text.contains('Active') || text.contains('tidak ditemukan')) {
    return 'Domain belum Active di Cloudflare atau email/key Cloudflare salah.';
  }
  if (text.contains('Telegram')) {
    return 'Token Telegram tidak valid atau bot belum siap.';
  }
  if (text.contains('D1') || text.contains('database')) {
    return 'Inbox D1 belum siap atau credential Cloudflare tidak punya akses. Cek setup dan simpan credential ulang.';
  }
  if (text.length > 150) return '${text.substring(0, 150)}…';
  return text;
}
