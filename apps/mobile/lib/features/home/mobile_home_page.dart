import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show rootBundle;

import '../../core/models/setup_models.dart';
import '../../core/theme/app_design.dart';
import '../../core/validators/input_validators.dart';
import '../../services/inbox_service.dart';
import '../../services/native_actions.dart';
import '../../services/provisioning_service.dart';
import '../../services/secure_config_store.dart';

class MobileHomePage extends StatefulWidget {
  const MobileHomePage({super.key});

  @override
  State<MobileHomePage> createState() => _MobileHomePageState();
}

class _MobileHomePageState extends State<MobileHomePage> {
  final ProvisioningService _provisioning = const ProvisioningService();
  final SecureConfigStore _secureStore = const SecureConfigStore();
  final TextEditingController _emailController = TextEditingController();
  final TextEditingController _globalKeyController = TextEditingController();
  final TextEditingController _botTokenController = TextEditingController();
  final TextEditingController _domainController = TextEditingController(text: 'dahus.my.id');
  final TextEditingController _scriptController = TextEditingController(text: 'telegram-tempmail');

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
    _restoreSavedState();
  }

  @override
  void dispose() {
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
      _showSnack('Form belum valid. Cek email, API key, bot token, dan domain.');
      return;
    }
    setState(() => _steps = _provisioning.initialSteps());
    _go(2);
    final workerSource = await rootBundle.loadString('assets/worker/main.js');
    String? error;
    await for (final update in _provisioning.runSetup(_draft, workerSource: workerSource)) {
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
      _showSnack('Disalin ke clipboard.');
    } on Object catch (error) {
      _showSnack('Tidak bisa copy: $error');
    }
  }

  Future<void> _controlExisting() async {
    if (!_draft.isControlValid) {
      _showSnack('Control existing butuh Cloudflare email, Global API Key, domain, dan script name. Bot token boleh kosong.');
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
      _showSnack('Connected. App sekarang kontrol deployment existing tanpa redeploy.');
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
      _showSnack('Credential belum valid. Isi email Cloudflare, Global API Key, bot token, domain, dan script name.');
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
      _showSnack('Domain ${InputValidators.normalizeDomain(domain)} berhasil ditambahkan.');
      _go(3);
    } on Object catch (error) {
      if (!mounted) return;
      _showSnack('Add domain gagal. ${humanizeError(error.toString())}');
    } finally {
      if (mounted) setState(() => _addingDomain = false);
    }
  }

  void _showSnack(String message) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    if (_restoringState) {
      return const Scaffold(
        body: SafeArea(
          child: Center(child: CircularProgressIndicator()),
        ),
      );
    }
    return Scaffold(
      body: AnimatedContainer(
        duration: const Duration(milliseconds: 450),
        curve: Curves.easeOutCubic,
        color: Theme.of(context).colorScheme.brightness == Brightness.dark ? AppColors.darkBackground : AppColors.background,
        child: SafeArea(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: AppSpacing.maxWidth),
              child: Column(
                children: <Widget>[
                  _TopBar(page: _page),
                  Expanded(
                    child: AnimatedSwitcher(
                      duration: const Duration(milliseconds: 260),
                      switchInCurve: Curves.easeOutCubic,
                      switchOutCurve: Curves.easeInCubic,
                      transitionBuilder: (child, animation) {
                        final slide = Tween<Offset>(begin: const Offset(.04, 0), end: Offset.zero).animate(animation);
                        return FadeTransition(
                          opacity: animation,
                          child: SlideTransition(position: slide, child: child),
                        );
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
          onToggleReplaceMx: (value) => setState(() => _replaceExistingMxRecords = value),
          isConnectingExisting: _connectingExisting,
          onToggleSecretMode: () => setState(() => _hideSecrets = !_hideSecrets),
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

class _TopBar extends StatelessWidget {
  const _TopBar({required this.page});

  final int page;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpacing.screen, 14, AppSpacing.screen, 8),
      child: Column(
        children: <Widget>[
          Row(
            children: <Widget>[
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: AppColors.primary,
                  borderRadius: BorderRadius.circular(14),
                ),
                child: const Icon(Icons.mark_email_unread_rounded, color: AppColors.onPrimary, size: 24),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text('Private TempMail', style: AppText.h2.copyWith(fontSize: 20)),
                    const SizedBox(height: 2),
                    const Text('Cloudflare + Telegram setup', style: AppText.caption),
                  ],
                ),
              ),
              _StepBadge(page: page),
            ],
          ),
          const SizedBox(height: 14),
          ClipRRect(
            borderRadius: BorderRadius.circular(999),
            child: LinearProgressIndicator(
              value: (page + 1) / 5,
              minHeight: 6,
              color: AppColors.primary,
              backgroundColor: AppColors.border,
            ),
          ),
        ],
      ),
    );
  }
}

class _StepBadge extends StatelessWidget {
  const _StepBadge({required this.page});

  final int page;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: AppColors.primary.withValues(alpha: .10),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: AppColors.primary.withValues(alpha: .28)),
      ),
      child: Text('Step ${page + 1}/5', style: AppText.caption.copyWith(color: AppColors.primaryVariant, fontWeight: FontWeight.w800)),
    );
  }
}

class _Screen extends StatelessWidget {
  const _Screen({required this.children, this.scroll = false});

  final List<Widget> children;
  final bool scroll;

  @override
  Widget build(BuildContext context) {
    final content = Padding(
      padding: const EdgeInsets.fromLTRB(AppSpacing.screen, 8, AppSpacing.screen, AppSpacing.screen),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
    );
    return scroll ? SingleChildScrollView(child: content) : content;
  }
}

class _AppCard extends StatelessWidget {
  const _AppCard({required this.child, this.accentColor, this.dimmed = false});

  final Widget child;
  final Color? accentColor;
  final bool dimmed;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).colorScheme.brightness == Brightness.dark;
    final surface = dark ? AppColors.darkSurface : AppColors.surface;
    final border = dark ? AppColors.darkBorder : AppColors.border;
    return AnimatedOpacity(
      duration: const Duration(milliseconds: 220),
      opacity: dimmed ? .58 : 1,
      child: Container(
        margin: const EdgeInsets.only(bottom: AppSpacing.section),
        decoration: BoxDecoration(
          color: surface,
          borderRadius: BorderRadius.circular(AppSpacing.radius),
          border: Border.all(color: border),
          boxShadow: dark ? const <BoxShadow>[] : AppShadows.card,
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

class _WelcomeStep extends StatelessWidget {
  const _WelcomeStep({required this.onStart});

  final VoidCallback onStart;

  @override
  Widget build(BuildContext context) {
    return _Screen(
      scroll: true,
      children: <Widget>[
        const SizedBox(height: 18),
        Center(
          child: TweenAnimationBuilder<double>(
            tween: Tween<double>(begin: .92, end: 1),
            duration: const Duration(milliseconds: 520),
            curve: Curves.easeOutBack,
            builder: (context, value, child) => Transform.scale(scale: value, child: child),
            child: Container(
              width: 86,
              height: 86,
              decoration: BoxDecoration(
                gradient: const LinearGradient(colors: <Color>[AppColors.primary, AppColors.primaryVariant]),
                borderRadius: BorderRadius.circular(26),
                boxShadow: <BoxShadow>[
                  BoxShadow(color: AppColors.primary.withValues(alpha: .28), blurRadius: 30, offset: const Offset(0, 12)),
                ],
              ),
              child: const Icon(Icons.mark_email_unread_rounded, color: AppColors.onPrimary, size: 42),
            ),
          ),
        ),
        const SizedBox(height: 24),
        const Text('Private TempMail', textAlign: TextAlign.center, style: AppText.h1),
        const SizedBox(height: 8),
        Text(
          'Disposable email powered by Cloudflare Workers + Telegram',
          textAlign: TextAlign.center,
          style: AppText.body.copyWith(color: AppColors.textSecondary),
        ),
        const SizedBox(height: 18),
        FilledButton.icon(
          onPressed: onStart,
          icon: const Icon(Icons.arrow_forward_rounded),
          label: const Text('Get Started'),
        ),
        const SizedBox(height: 10),
        OutlinedButton.icon(
          onPressed: onStart,
          icon: const Icon(Icons.settings_rounded),
          label: const Text('Open Configuration'),
        ),
        const SizedBox(height: 14),
        const _AppCard(
          accentColor: AppColors.primary,
          child: _Checklist(items: <String>[
            'Cloudflare Free compatible',
            'No local server after setup',
            'Multi-domain temp mail routing',
            'Telegram bot + web dashboard',
          ]),
        ),
      ],
    );
  }
}

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
        const Text('Pilih Deploy untuk setup/redeploy, atau Control Existing untuk login dan kontrol Worker yang sudah ada tanpa deploy ulang.', style: AppText.body),
        const SizedBox(height: AppSpacing.section),
        _AppCard(
          accentColor: AppColors.primary,
          child: Column(
            children: <Widget>[
              _Field(
                controller: emailController,
                label: 'Cloudflare email',
                helper: 'Email login Cloudflare kamu.',
                icon: Icons.alternate_email,
                validator: InputValidators.isCloudflareEmail,
              ),
              _Field(
                controller: globalKeyController,
                label: 'Cloudflare Global API Key',
                helper: 'Key dari Cloudflare > My Profile > API Tokens > Global API Key.',
                icon: Icons.key_rounded,
                obscure: hideSecrets,
                validator: InputValidators.isGlobalApiKey,
              ),
              _Field(
                controller: botTokenController,
                label: 'Telegram Bot Token',
                helper: 'Wajib untuk Deploy. Opsional untuk Control Existing/native inbox.',
                icon: Icons.smart_toy_rounded,
                obscure: hideSecrets,
                validator: (value) => value.trim().isEmpty || InputValidators.isTelegramBotToken(value),
              ),
              _Field(
                controller: domainController,
                label: 'Domain utama',
                helper: 'Domain harus sudah Active/onboard di Cloudflare.',
                icon: Icons.language_rounded,
                validator: InputValidators.isDomain,
              ),
              _Field(
                controller: scriptController,
                label: 'Worker script name',
                helper: 'Default aman: telegram-tempmail.',
                icon: Icons.cloud_rounded,
                validator: (value) => InputValidators.isScriptName(InputValidators.normalizeScriptName(value, domainController.text)),
              ),
            ],
          ),
        ),
        _AppCard(
          accentColor: replaceExistingMxRecords ? AppColors.warning : AppColors.pending,
          child: Column(
            children: <Widget>[
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                value: saveCredentials,
                onChanged: onToggleSave,
                title: const Text('Simpan credential aman di device', style: AppText.h2),
                subtitle: const Text('Credential disimpan terenkripsi via Android Keystore untuk inbox native.', style: AppText.caption),
              ),
              const Divider(height: 18),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                value: replaceExistingMxRecords,
                onChanged: onToggleReplaceMx,
                title: const Text('Ganti MX lama otomatis', style: AppText.h2),
                subtitle: const Text('Hapus MX non-Cloudflare jika Cloudflare menolak Email Routing. Gunakan hanya untuk domain test/kosong.', style: AppText.caption),
              ),
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: onToggleSecretMode,
                  icon: Icon(hideSecrets ? Icons.visibility_rounded : Icons.visibility_off_rounded),
                  label: Text(hideSecrets ? 'Tampilkan secret' : 'Sembunyikan secret'),
                ),
              ),
            ],
          ),
        ),
        Row(
          children: <Widget>[
            Expanded(child: OutlinedButton(onPressed: onBack, child: const Text('Back'))),
            const SizedBox(width: 12),
            Expanded(child: FilledButton(onPressed: onSubmit, child: const Text('Deploy / Redeploy'))),
          ],
        ),
        const SizedBox(height: 10),
        OutlinedButton.icon(
          onPressed: isConnectingExisting ? null : onControlExisting,
          icon: isConnectingExisting
              ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2.3))
              : const Icon(Icons.login_rounded),
          label: Text(isConnectingExisting ? 'Connecting...' : 'Control Existing (No Deploy)'),
        ),
      ],
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
      padding: const EdgeInsets.only(bottom: 14),
      child: TextField(
        controller: widget.controller,
        obscureText: widget.obscure,
        minLines: 1,
        onChanged: (_) => setState(() => _touched = true),
        decoration: InputDecoration(
          prefixIcon: Icon(widget.icon, size: 22),
          suffixIcon: showOk
              ? const Icon(Icons.check_circle_rounded, color: AppColors.success)
              : showError
                  ? const Icon(Icons.error_rounded, color: AppColors.error)
                  : null,
          labelText: widget.label,
          helperText: widget.helper,
          errorText: showError ? 'Format belum valid' : null,
        ),
      ),
    );
  }
}

class _ProgressStep extends StatelessWidget {
  const _ProgressStep({required this.steps, required this.onContinue});

  final List<ProvisioningStep> steps;
  final VoidCallback? onContinue;

  @override
  Widget build(BuildContext context) {
    final completed = steps.where((step) => step.status == ProvisioningStepStatus.ok).length;
    final failed = steps.any((step) => step.status == ProvisioningStepStatus.failed);
    return _Screen(
      scroll: true,
      children: <Widget>[
        const Text('Setup Wizard', style: AppText.h1),
        const SizedBox(height: 6),
        Text('$completed dari ${steps.length} langkah selesai', style: AppText.body),
        const SizedBox(height: 12),
        ClipRRect(
          borderRadius: BorderRadius.circular(999),
          child: LinearProgressIndicator(
            value: completed / max(steps.length, 1),
            minHeight: 8,
            color: failed ? AppColors.error : AppColors.primary,
            backgroundColor: AppColors.border,
          ),
        ),
        const SizedBox(height: AppSpacing.section),
        for (final step in steps) _StepTile(step: step),
        if (onContinue != null) ...<Widget>[
          const SizedBox(height: 4),
          FilledButton.icon(
            onPressed: onContinue,
            icon: const Icon(Icons.dashboard_rounded),
            label: const Text('Open Dashboard'),
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

class _StepTileState extends State<_StepTile> with SingleTickerProviderStateMixin {
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
      ProvisioningStepStatus.failed => Icons.error_rounded,
      ProvisioningStepStatus.running => Icons.sync_rounded,
      _ => Icons.radio_button_unchecked_rounded,
    };
    final body = Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        running
            ? SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: color))
            : Icon(icon, color: color, size: 22),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(step.title, style: AppText.h2.copyWith(fontSize: 16)),
              if (step.detail.isNotEmpty) ...<Widget>[
                const SizedBox(height: 4),
                Text(humanizeError(step.detail), style: failed ? AppText.caption.copyWith(color: AppColors.error, fontWeight: FontWeight.w700) : AppText.caption),
              ],
              if (failed && step.detail.isNotEmpty) ...<Widget>[
                const SizedBox(height: 8),
                Theme(
                  data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
                  child: ExpansionTile(
                    tilePadding: EdgeInsets.zero,
                    childrenPadding: EdgeInsets.zero,
                    title: Text('Show details', style: AppText.caption.copyWith(fontWeight: FontWeight.w800)),
                    children: <Widget>[
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: AppColors.error.withValues(alpha: .06),
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: AppColors.error.withValues(alpha: .18)),
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
                  opacity: .86 + (_controller.value * .14),
                  child: child,
                )
              : child!,
        );
      },
      child: body,
    );
  }
}

class _DashboardStep extends StatelessWidget {
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
  Widget build(BuildContext context) {
    final current = state;
    return _Screen(
      scroll: true,
      children: <Widget>[
        const Text('Manage TempMail', style: AppText.h1),
        const SizedBox(height: 6),
        const Text('Kelola domain, alamat tempmail, dashboard inbox, dan Telegram bot.', style: AppText.body),
        const SizedBox(height: AppSpacing.section),
        if (current == null)
          _AppCard(
            accentColor: AppColors.warning,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                const Text('Belum ada setup state', style: AppText.h2),
                const SizedBox(height: 6),
                const Text('Jalankan setup utama dulu sebelum mengelola tempmail.', style: AppText.body),
                const SizedBox(height: 12),
                FilledButton(onPressed: onReset, child: const Text('Open setup')),
              ],
            ),
          )
        else ...<Widget>[
          _SummaryCard(state: current, credentials: credentials, onOpenUrl: onOpenUrl, onCopyText: onCopyText),
          _AddressManagerCard(state: current, onCopyText: onCopyText),
          _InboxCard(state: current, credentials: credentials, onOpenUrl: onOpenUrl, onSaveCredentials: onSaveCredentials),
          Row(
            children: <Widget>[
              Expanded(child: FilledButton.icon(onPressed: onAddDomain, icon: const Icon(Icons.add_link_rounded), label: const Text('Add domain'))),
              const SizedBox(width: 12),
              Expanded(child: OutlinedButton.icon(onPressed: onReset, icon: const Icon(Icons.settings_rounded), label: const Text('Edit setup'))),
            ],
          ),
        ],
      ],
    );
  }
}

class _SummaryCard extends StatelessWidget {
  const _SummaryCard({required this.state, required this.credentials, required this.onOpenUrl, required this.onCopyText});

  final MobileSetupState state;
  final StoredCredentials? credentials;
  final ValueChanged<String> onOpenUrl;
  final ValueChanged<String> onCopyText;

  @override
  Widget build(BuildContext context) {
    return _AppCard(
      accentColor: AppColors.success,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              const Icon(Icons.check_circle_rounded, color: AppColors.success, size: 28),
              const SizedBox(width: 10),
              Expanded(child: Text('Setup Complete!', style: AppText.h2.copyWith(fontSize: 20))),
            ],
          ),
          const SizedBox(height: 12),
          _InfoRow(label: 'Primary domain', value: state.primaryDomain),
          _InfoRow(label: 'Telegram bot', value: state.botUsername.isEmpty ? '-' : '@${state.botUsername}'),
          _InfoRow(label: 'Worker URL', value: state.workerUrl, monospace: true),
          _InfoRow(label: 'Domains', value: state.domains.join(', ')),
          _InfoRow(label: 'Secure storage', value: credentials == null ? 'Credential belum tersimpan' : 'Credential terenkripsi aktif'),
          const SizedBox(height: 10),
          Row(
            children: <Widget>[
              Expanded(
                child: FilledButton.icon(
                  onPressed: state.claimLink.isEmpty ? null : () => onOpenUrl(state.claimLink),
                  icon: const Icon(Icons.smart_toy_rounded),
                  label: const Text('Open Bot'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: state.claimLink.isEmpty ? null : () => onCopyText(state.claimLink),
                  icon: const Icon(Icons.copy_rounded),
                  label: const Text('Copy Link'),
                ),
              ),
            ],
          ),
        ],
      ),
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
  final TextEditingController _localController = TextEditingController(text: 'test');
  late String _domain = widget.state.domains.first;
  String _address = '';

  @override
  void didUpdateWidget(covariant _AddressManagerCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!widget.state.domains.contains(_domain)) _domain = widget.state.domains.first;
  }

  @override
  void dispose() {
    _localController.dispose();
    super.dispose();
  }

  void _generate({bool random = false}) {
    final local = random ? _randomLocal() : InputValidators.normalizeScriptName(_localController.text, _domain).replaceFirst(RegExp(r'^telegram-tempmail-'), '');
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
    return _AppCard(
      accentColor: AppColors.primary,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Text('Create temp mail', style: AppText.h2),
          const SizedBox(height: 6),
          const Text('Cloudflare catch-all menerima alias apa pun. Buat alamat lalu copy untuk menerima OTP/email.', style: AppText.caption),
          const SizedBox(height: 12),
          TextField(
            controller: _localController,
            decoration: const InputDecoration(prefixIcon: Icon(Icons.alternate_email_rounded), labelText: 'Alias local-part', helperText: 'Contoh: tokopedia, login-test, apk01'),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: _domain,
            items: widget.state.domains.map((domain) => DropdownMenuItem<String>(value: domain, child: Text('@$domain'))).toList(growable: false),
            onChanged: (value) => setState(() => _domain = value ?? _domain),
            decoration: const InputDecoration(prefixIcon: Icon(Icons.language_rounded), labelText: 'Domain'),
          ),
          const SizedBox(height: 12),
          Row(
            children: <Widget>[
              Expanded(child: FilledButton(onPressed: _generate, child: const Text('Create'))),
              const SizedBox(width: 10),
              Expanded(child: OutlinedButton(onPressed: () => _generate(random: true), child: const Text('Random'))),
            ],
          ),
          if (_address.isNotEmpty) ...<Widget>[
            const SizedBox(height: 12),
            _CodeBox(value: _address),
            const SizedBox(height: 8),
            FilledButton.icon(onPressed: () => widget.onCopyText(_address), icon: const Icon(Icons.copy_rounded), label: const Text('Copy temp mail')),
          ],
        ],
      ),
    );
  }
}

class _InboxCard extends StatefulWidget {
  const _InboxCard({required this.state, required this.credentials, required this.onOpenUrl, required this.onSaveCredentials});

  final MobileSetupState state;
  final StoredCredentials? credentials;
  final ValueChanged<String> onOpenUrl;
  final VoidCallback onSaveCredentials;

  @override
  State<_InboxCard> createState() => _InboxCardState();
}

class _InboxCardState extends State<_InboxCard> {
  final InboxService _inbox = const InboxService();
  List<InboxMessage> _messages = const <InboxMessage>[];
  InboxMessage? _selected;
  bool _loading = false;
  String _error = '';

  @override
  void initState() {
    super.initState();
    if (widget.credentials != null) {
      unawaited(_refresh());
    }
  }

  @override
  void didUpdateWidget(covariant _InboxCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.credentials == null && widget.credentials != null) {
      unawaited(_refresh());
    }
  }

  Future<void> _refresh() async {
    final credentials = widget.credentials;
    if (credentials == null) return;
    setState(() {
      _loading = true;
      _error = '';
    });
    try {
      final messages = await _inbox.listMessages(state: widget.state, credentials: credentials);
      if (!mounted) return;
      setState(() {
        _messages = messages;
        if (_selected != null && !messages.any((message) => message.id == _selected!.id)) _selected = null;
      });
    } on Object catch (error) {
      if (!mounted) return;
      setState(() => _error = humanizeError(error.toString()));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _deleteSelected() async {
    final credentials = widget.credentials;
    final selected = _selected;
    if (credentials == null || selected == null) return;
    setState(() => _loading = true);
    try {
      await _inbox.deleteMessage(state: widget.state, credentials: credentials, id: selected.id);
      if (!mounted) return;
      setState(() => _selected = null);
      await _refresh();
    } on Object catch (error) {
      if (!mounted) return;
      setState(() => _error = humanizeError(error.toString()));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _purgeOtp() async {
    final credentials = widget.credentials;
    if (credentials == null) return;
    setState(() => _loading = true);
    try {
      await _inbox.purgeOtp(state: widget.state, credentials: credentials);
      await _refresh();
    } on Object catch (error) {
      if (!mounted) return;
      setState(() => _error = humanizeError(error.toString()));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final credentials = widget.credentials;
    return _AppCard(
      accentColor: credentials == null ? AppColors.warning : AppColors.blue,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              const Expanded(child: Text('Native inbox', style: AppText.h2)),
              if (_loading) const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2.3)),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            credentials == null
                ? 'Credential belum tersimpan. Simpan credential terenkripsi untuk membaca D1 langsung dari app.'
                : 'Inbox dibaca langsung dari Cloudflare D1. Web dashboard tetap tersedia sebagai fallback.',
            style: AppText.caption,
          ),
          const SizedBox(height: 12),
          if (credentials == null) ...<Widget>[
            FilledButton.icon(onPressed: widget.onSaveCredentials, icon: const Icon(Icons.lock_rounded), label: const Text('Save credential securely')),
            const SizedBox(height: 8),
          ] else ...<Widget>[
            Row(
              children: <Widget>[
                Expanded(child: FilledButton.icon(onPressed: _loading ? null : _refresh, icon: const Icon(Icons.refresh_rounded), label: const Text('Refresh'))),
                const SizedBox(width: 10),
                Expanded(child: OutlinedButton.icon(onPressed: _loading ? null : _purgeOtp, icon: const Icon(Icons.cleaning_services_rounded), label: const Text('Purge OTP'))),
              ],
            ),
            if (_error.isNotEmpty) ...<Widget>[
              const SizedBox(height: 10),
              Text(_error, style: AppText.caption.copyWith(color: AppColors.error, fontWeight: FontWeight.w700)),
            ],
            const SizedBox(height: 12),
            if (_messages.isEmpty && !_loading && _error.isEmpty)
              const _EmptyState(text: 'Belum ada email di D1 inbox. Kirim email test ke alias tempmail lalu refresh.')
            else
              for (final message in _messages.take(8)) _InboxMessageTile(message: message, selected: _selected?.id == message.id, onTap: () => setState(() => _selected = message)),
            if (_selected != null) ...<Widget>[
              const SizedBox(height: 8),
              _MessageDetail(message: _selected!, onDelete: _loading ? null : _deleteSelected),
            ],
          ],
          OutlinedButton.icon(
            onPressed: () => widget.onOpenUrl(widget.state.dashboardUrl),
            icon: const Icon(Icons.open_in_browser_rounded),
            label: const Text('Open Web Dashboard'),
          ),
        ],
      ),
    );
  }
}

class _InboxMessageTile extends StatelessWidget {
  const _InboxMessageTile({required this.message, required this.selected, required this.onTap});

  final InboxMessage message;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        border: Border.all(color: selected ? AppColors.primary : AppColors.border),
        borderRadius: BorderRadius.circular(12),
      ),
      child: ListTile(
        onTap: onTap,
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        title: Text(message.subject, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.body.copyWith(fontWeight: FontWeight.w800)),
        subtitle: Text('${message.sender}\n${message.previewText}', maxLines: 2, overflow: TextOverflow.ellipsis, style: AppText.caption),
        trailing: message.isOtp ? _Pill(text: message.otpCode == '-' ? 'OTP' : message.otpCode, color: AppColors.success) : null,
      ),
    );
  }
}

class _MessageDetail extends StatelessWidget {
  const _MessageDetail({required this.message, required this.onDelete});

  final InboxMessage message;
  final VoidCallback? onDelete;

  @override
  Widget build(BuildContext context) {
    final body = message.renderedHtml.isNotEmpty ? stripHtml(message.renderedHtml) : message.previewText;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.background,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(message.aliasFull, style: AppText.caption.copyWith(fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          Text(message.subject, style: AppText.h2.copyWith(fontSize: 16)),
          const SizedBox(height: 6),
          Text('From: ${message.sender}', style: AppText.caption),
          if (message.isOtp) Text('OTP: ${message.otpCode}', style: AppText.body.copyWith(color: AppColors.success, fontWeight: FontWeight.w900)),
          const SizedBox(height: 8),
          Text(body.isEmpty ? '(no preview)' : body, style: AppText.body),
          const SizedBox(height: 10),
          OutlinedButton.icon(onPressed: onDelete, icon: const Icon(Icons.delete_outline_rounded), label: const Text('Delete email')),
        ],
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Center(child: Text(text, textAlign: TextAlign.center, style: AppText.caption)),
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill({required this.text, required this.color});

  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(color: color.withValues(alpha: .12), borderRadius: BorderRadius.circular(999)),
      child: Text(text, style: AppText.caption.copyWith(color: color, fontWeight: FontWeight.w900)),
    );
  }
}

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
  final TextEditingController _domainController = TextEditingController(text: 'excalibur.email');
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
        Text('Domain harus Active di Cloudflare dan satu akun dengan ${widget.primaryDomain}.', style: AppText.body),
        const SizedBox(height: AppSpacing.section),
        _AppCard(
          accentColor: _force ? AppColors.warning : AppColors.primary,
          child: Column(
            children: <Widget>[
              TextField(
                controller: _domainController,
                decoration: const InputDecoration(prefixIcon: Icon(Icons.add_link_rounded), labelText: 'Domain tambahan', helperText: 'Contoh: excalibur.email'),
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                value: _force,
                onChanged: widget.isRunning ? null : (value) => setState(() => _force = value),
                title: const Text('Force replace catch-all / old MX', style: AppText.h2),
                subtitle: const Text('Aktifkan hanya untuk domain test/kosong karena bisa menghapus MX lama.', style: AppText.caption),
              ),
            ],
          ),
        ),
        FilledButton.icon(
          onPressed: widget.isRunning
              ? null
              : () {
                  final domain = InputValidators.normalizeDomain(_domainController.text);
                  final valid = InputValidators.isDomain(domain);
                  if (!valid) {
                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Domain tidak valid')));
                    return;
                  }
                  widget.onAddDomain(domain, _force);
                },
          icon: widget.isRunning ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white)) : const Icon(Icons.play_arrow_rounded),
          label: Text(widget.isRunning ? 'Adding...' : 'Add domain now'),
        ),
        const SizedBox(height: 10),
        OutlinedButton(onPressed: widget.isRunning ? null : widget.onBack, child: const Text('Back')),
      ],
    );
  }
}

class _Checklist extends StatelessWidget {
  const _Checklist({required this.items});

  final List<String> items;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: <Widget>[
        for (final item in items)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Row(
              children: <Widget>[
                const Icon(Icons.check_circle_rounded, color: AppColors.success, size: 20),
                const SizedBox(width: 10),
                Expanded(child: Text(item, style: AppText.body.copyWith(fontWeight: FontWeight.w600))),
              ],
            ),
          ),
      ],
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.label, required this.value, this.monospace = false});

  final String label;
  final String value;
  final bool monospace;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(label, style: AppText.caption.copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(height: 4),
          SelectableText(value, style: monospace ? AppText.mono : AppText.body.copyWith(fontWeight: FontWeight.w700, color: AppColors.textPrimary)),
        ],
      ),
    );
  }
}

class _CodeBox extends StatelessWidget {
  const _CodeBox({required this.value});

  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.background,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.border),
      ),
      child: SelectableText(value, style: AppText.mono.copyWith(fontWeight: FontWeight.w800)),
    );
  }
}

String stripHtml(String raw) {
  return raw
      .replaceAll(RegExp(r'<br\s*/?>', caseSensitive: false), '\n')
      .replaceAll(RegExp(r'</p>', caseSensitive: false), '\n')
      .replaceAll(RegExp(r'<[^>]+>'), ' ')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
}

String humanizeError(String raw) {
  final text = raw.replaceFirst('Exception: ', '');
  if (text.contains('Non-Cloudflare MX records exist') || text.contains('2008')) {
    return 'Domain masih punya MX lama. Aktifkan “Ganti MX lama otomatis” jika domain ini memang untuk tempmail/test.';
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
