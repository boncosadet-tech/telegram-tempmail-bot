import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show rootBundle;

import '../../core/models/setup_models.dart';
import '../../core/validators/input_validators.dart';
import '../../services/native_actions.dart';
import '../../services/provisioning_service.dart';

class MobileHomePage extends StatefulWidget {
  const MobileHomePage({super.key});

  @override
  State<MobileHomePage> createState() => _MobileHomePageState();
}

class _MobileHomePageState extends State<MobileHomePage> {
  final PageController _pageController = PageController();
  final ProvisioningService _provisioning = const ProvisioningService();
  final TextEditingController _emailController = TextEditingController();
  final TextEditingController _globalKeyController = TextEditingController();
  final TextEditingController _botTokenController = TextEditingController();
  final TextEditingController _domainController = TextEditingController(text: 'dahus.my.id');
  final TextEditingController _scriptController = TextEditingController(text: 'telegram-tempmail');

  bool _saveCredentials = false;
  bool _replaceExistingMxRecords = false;
  bool _hideSecrets = true;
  bool _addingDomain = false;
  int _page = 0;
  List<ProvisioningStep> _steps = const ProvisioningService().initialSteps();
  MobileSetupState? _setupState;

  @override
  void dispose() {
    _pageController.dispose();
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
    _pageController.animateToPage(
      page,
      duration: const Duration(milliseconds: 360),
      curve: Curves.easeOutCubic,
    );
  }

  Future<void> _runSetup() async {
    if (!_draft.isValid) {
      _showSnack('Form belum valid. Cek email, API key, bot token, dan domain.');
      return;
    }
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
    }
    if (!mounted) return;
    if (error != null) {
      _showSnack('Setup gagal: $error');
      return;
    }
    _showSnack('Setup selesai. Buka claim link di Telegram.');
    _go(3);
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
      if (!mounted) return;
      setState(() => _setupState = next);
      _showSnack('Domain ${InputValidators.normalizeDomain(domain)} berhasil ditambahkan.');
      _go(3);
    } on Object catch (error) {
      if (!mounted) return;
      _showSnack('Add domain gagal: $error');
    } finally {
      if (mounted) setState(() => _addingDomain = false);
    }
  }

  void _showSnack(String message) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: AnimatedContainer(
        duration: const Duration(milliseconds: 520),
        curve: Curves.easeOutCubic,
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: _page.isEven
                ? const <Color>[Color(0xFFFFFBEA), Color(0xFFFFE082), Color(0xFFFFB300)]
                : const <Color>[Color(0xFFFFFBF0), Color(0xFFFFD45A), Color(0xFFFF8A00)],
          ),
        ),
        child: SafeArea(
          child: Column(
            children: <Widget>[
              _TopBar(page: _page),
              Expanded(
                child: PageView(
                  controller: _pageController,
                  physics: const NeverScrollableScrollPhysics(),
                  children: <Widget>[
                    _WelcomeStep(onStart: () => _go(1)),
                    _CredentialsStep(
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
                      onToggleSecretMode: () => setState(() => _hideSecrets = !_hideSecrets),
                      onBack: () => _go(0),
                      onSubmit: _runSetup,
                    ),
                    _ProgressStep(steps: _steps),
                    _DashboardStep(
                      state: _setupState,
                      onAddDomain: () => _go(4),
                      onReset: () => _go(1),
                      onOpenUrl: _openUrl,
                      onCopyText: _copyText,
                    ),
                    _AddDomainStep(
                      primaryDomain: _setupState?.primaryDomain ?? _draft.normalizedDomain,
                      isRunning: _addingDomain,
                      onAddDomain: _addDomain,
                      onBack: () => _go(3),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _TopBar extends StatelessWidget {
  const _TopBar({required this.page});

  final int page;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 12, 18, 8),
      child: Row(
        children: <Widget>[
          Container(
            width: 46,
            height: 46,
            decoration: BoxDecoration(
              color: const Color(0xFF171717),
              borderRadius: BorderRadius.circular(16),
              boxShadow: const <BoxShadow>[BoxShadow(offset: Offset(3, 3), color: Color(0xFFFFC928))],
            ),
            child: const Icon(Icons.mark_email_unread_rounded, color: Color(0xFFFFD84D)),
          ),
          const SizedBox(width: 12),
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text('Private TempMail', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 20)),
                Text('Cloudflare + Telegram setup APK', style: TextStyle(color: Color(0xFF6B5F3F))),
              ],
            ),
          ),
          Text('${page + 1}/5', style: const TextStyle(fontWeight: FontWeight.w900)),
        ],
      ),
    );
  }
}

class _Card extends StatelessWidget {
  const _Card({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween<double>(begin: .96, end: 1),
      duration: const Duration(milliseconds: 420),
      curve: Curves.easeOutBack,
      builder: (context, value, child) {
        return Transform.scale(
          scale: value,
          child: child,
        );
      },
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 280),
        curve: Curves.easeOutCubic,
        width: double.infinity,
        margin: const EdgeInsets.all(18),
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: const Color(0xF0FFFFFF),
          border: Border.all(color: const Color(0xFF171717), width: 3),
          borderRadius: BorderRadius.circular(28),
          boxShadow: const <BoxShadow>[BoxShadow(offset: Offset(8, 8), color: Color(0xFF171717))],
        ),
        child: child,
      ),
    );
  }
}

class _WelcomeStep extends StatelessWidget {
  const _WelcomeStep({required this.onStart});

  final VoidCallback onStart;

  @override
  Widget build(BuildContext context) {
    return _Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Text('Setup tempmail dari HP', style: TextStyle(fontSize: 34, fontWeight: FontWeight.w900, height: .95)),
          const SizedBox(height: 14),
          const Text('Versi mobile untuk npm app yang sudah ada. Runtime tetap Cloudflare-only, HP hanya dipakai untuk setup dan admin.'),
          const SizedBox(height: 20),
          const _Checklist(items: <String>[
            'Cloudflare Free compatible',
            'Tanpa VPS / Termux setelah setup',
            'Support multi-domain: dahus.my.id + excalibur.email',
            'Telegram bot UI dengan tombol inline',
          ]),
          const Spacer(),
          FilledButton.icon(
            onPressed: onStart,
            icon: const Icon(Icons.rocket_launch_rounded),
            label: const Text('Mulai setup'),
          ),
        ],
      ),
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
    required this.onToggleSave,
    required this.onToggleReplaceMx,
    required this.onToggleSecretMode,
    required this.onBack,
    required this.onSubmit,
  });

  final TextEditingController emailController;
  final TextEditingController globalKeyController;
  final TextEditingController botTokenController;
  final TextEditingController domainController;
  final TextEditingController scriptController;
  final bool saveCredentials;
  final bool replaceExistingMxRecords;
  final bool hideSecrets;
  final ValueChanged<bool> onToggleSave;
  final ValueChanged<bool> onToggleReplaceMx;
  final VoidCallback onToggleSecretMode;
  final VoidCallback onBack;
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      child: _Card(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            const Text('Credential setup', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w900)),
            const SizedBox(height: 8),
            const Text('Credential dipakai langsung dari device ke Cloudflare/Telegram. Jangan lanjut kalau domain production masih punya email lama aktif.'),
            const SizedBox(height: 16),
            _Field(controller: emailController, label: 'Cloudflare email', icon: Icons.alternate_email),
            _Field(controller: globalKeyController, label: 'Cloudflare Global API Key', icon: Icons.key, obscure: hideSecrets),
            _Field(controller: botTokenController, label: 'Telegram Bot Token', icon: Icons.smart_toy_rounded, obscure: hideSecrets),
            _Field(controller: domainController, label: 'Domain utama', icon: Icons.language_rounded),
            _Field(controller: scriptController, label: 'Worker script name', icon: Icons.cloud_rounded),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: saveCredentials,
              onChanged: onToggleSave,
              title: const Text('Simpan credential aman di device'),
              subtitle: const Text('Belum aktif sampai secure storage selesai; credential tidak disimpan permanen.'),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: replaceExistingMxRecords,
              onChanged: onToggleReplaceMx,
              title: const Text('Ganti MX lama otomatis'),
              subtitle: const Text('Hapus MX non-Cloudflare jika Cloudflare menolak Email Routing. Gunakan hanya untuk domain test/kosong.'),
            ),
            TextButton.icon(
              onPressed: onToggleSecretMode,
              icon: Icon(hideSecrets ? Icons.visibility : Icons.visibility_off),
              label: Text(hideSecrets ? 'Tampilkan secret' : 'Sembunyikan secret'),
            ),
            Row(
              children: <Widget>[
                Expanded(child: OutlinedButton(onPressed: onBack, child: const Text('Kembali'))),
                const SizedBox(width: 12),
                Expanded(child: FilledButton(onPressed: onSubmit, child: const Text('Setup sekarang'))),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _Field extends StatelessWidget {
  const _Field({required this.controller, required this.label, required this.icon, this.obscure = false});

  final TextEditingController controller;
  final String label;
  final IconData icon;
  final bool obscure;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextField(
        controller: controller,
        obscureText: obscure,
        decoration: InputDecoration(
          prefixIcon: Icon(icon),
          labelText: label,
          filled: true,
          fillColor: const Color(0xFFFFFBEA),
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(18)),
        ),
      ),
    );
  }
}

class _ProgressStep extends StatelessWidget {
  const _ProgressStep({required this.steps});

  final List<ProvisioningStep> steps;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      child: _Card(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            const Text('Setup progress', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w900)),
            const SizedBox(height: 10),
            for (final step in steps) _StepTile(step: step),
          ],
        ),
      ),
    );
  }
}

class _StepTile extends StatelessWidget {
  const _StepTile({required this.step});

  final ProvisioningStep step;

  @override
  Widget build(BuildContext context) {
    final icon = switch (step.status) {
      ProvisioningStepStatus.pending => Icons.radio_button_unchecked,
      ProvisioningStepStatus.running => Icons.sync,
      ProvisioningStepStatus.ok => Icons.check_circle,
      ProvisioningStepStatus.failed => Icons.error,
    };
    final color = switch (step.status) {
      ProvisioningStepStatus.pending => Colors.grey,
      ProvisioningStepStatus.running => Colors.orange,
      ProvisioningStepStatus.ok => Colors.green,
      ProvisioningStepStatus.failed => Colors.red,
    };
    return AnimatedContainer(
      duration: const Duration(milliseconds: 260),
      curve: Curves.easeOutCubic,
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: color.withValues(alpha: step.status == ProvisioningStepStatus.pending ? .04 : .10),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: color.withValues(alpha: .22)),
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
        leading: AnimatedSwitcher(
          duration: const Duration(milliseconds: 220),
          child: Icon(icon, key: ValueKey<ProvisioningStepStatus>(step.status), color: color),
        ),
        title: Text(step.title, style: const TextStyle(fontWeight: FontWeight.w800)),
        subtitle: step.detail.isEmpty ? null : Text(step.detail),
        trailing: step.status == ProvisioningStepStatus.running
            ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2.4))
            : null,
      ),
    );
  }
}

class _DashboardStep extends StatelessWidget {
  const _DashboardStep({
    required this.state,
    required this.onAddDomain,
    required this.onReset,
    required this.onOpenUrl,
    required this.onCopyText,
  });

  final MobileSetupState? state;
  final VoidCallback onAddDomain;
  final VoidCallback onReset;
  final ValueChanged<String> onOpenUrl;
  final ValueChanged<String> onCopyText;

  @override
  Widget build(BuildContext context) {
    final current = state;
    return _Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Text('Dashboard', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w900)),
          const SizedBox(height: 12),
          if (current == null)
            const Text('Belum ada setup state. Jalankan setup dulu.')
          else ...<Widget>[
            _InfoRow(label: 'Domain', value: current.primaryDomain),
            _InfoRow(label: 'Script', value: current.scriptName),
            _InfoRow(label: 'Worker', value: current.workerUrl),
            _InfoRow(label: 'Dashboard', value: current.dashboardUrl),
            _InfoRow(label: 'Domains', value: current.domains.join(', ')),
            if (current.claimLink.isNotEmpty) _InfoRow(label: 'Claim link', value: current.claimLink),
            if (current.botUsername.isNotEmpty) _InfoRow(label: 'Bot', value: '@${current.botUsername}'),
          ],
          const Spacer(),
          if (current != null) ...<Widget>[
            FilledButton.icon(
              onPressed: current.claimLink.isEmpty ? null : () => onOpenUrl(current.claimLink),
              icon: const Icon(Icons.smart_toy_rounded),
              label: const Text('Claim di Telegram'),
            ),
            const SizedBox(height: 8),
            FilledButton.tonalIcon(
              onPressed: () => onOpenUrl(current.dashboardUrl),
              icon: const Icon(Icons.dashboard_rounded),
              label: const Text('Buka dashboard'),
            ),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: current.claimLink.isEmpty ? null : () => onCopyText(current.claimLink),
              icon: const Icon(Icons.copy_rounded),
              label: const Text('Copy claim link'),
            ),
            const SizedBox(height: 8),
          ],
          FilledButton.icon(onPressed: onAddDomain, icon: const Icon(Icons.add_link), label: const Text('Tambah domain')),
          const SizedBox(height: 8),
          OutlinedButton.icon(onPressed: onReset, icon: const Icon(Icons.settings), label: const Text('Edit setup')),
        ],
      ),
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
    return _Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Text('Tambah domain', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w900)),
          const SizedBox(height: 8),
          Text('Domain harus sudah Active di Cloudflare dan satu akun dengan ${widget.primaryDomain}.'),
          const SizedBox(height: 16),
          _Field(controller: _domainController, label: 'Domain tambahan', icon: Icons.add_link),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            value: _force,
            onChanged: (value) => setState(() => _force = value),
            title: const Text('Force replace catch-all'),
            subtitle: const Text('Aktifkan hanya kalau yakin domain test/kosong.'),
          ),
          const Spacer(),
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
            icon: widget.isRunning
                ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2.4))
                : const Icon(Icons.play_arrow_rounded),
            label: Text(widget.isRunning ? 'Menambahkan...' : 'Tambah domain sekarang'),
          ),
          const SizedBox(height: 8),
          OutlinedButton(onPressed: widget.onBack, child: const Text('Kembali')),
        ],
      ),
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
                const Icon(Icons.check_circle, color: Colors.green),
                const SizedBox(width: 10),
                Expanded(child: Text(item, style: const TextStyle(fontWeight: FontWeight.w700))),
              ],
            ),
          ),
      ],
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFFFFBEA),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0x33171717)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(label, style: const TextStyle(color: Color(0xFF6B5F3F), fontWeight: FontWeight.w700)),
          const SizedBox(height: 4),
          Text(value, style: const TextStyle(fontWeight: FontWeight.w900)),
        ],
      ),
    );
  }
}
