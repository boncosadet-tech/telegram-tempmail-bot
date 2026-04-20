import 'package:flutter/material.dart';

import '../../core/models/setup_models.dart';
import '../../core/validators/input_validators.dart';
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
  bool _hideSecrets = true;
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
      );

  void _go(int page) {
    setState(() => _page = page);
    _pageController.animateToPage(
      page,
      duration: const Duration(milliseconds: 360),
      curve: Curves.easeOutCubic,
    );
  }

  Future<void> _runDrySetup() async {
    if (!_draft.isValid) {
      _showSnack('Form belum valid. Cek email, API key, bot token, dan domain.');
      return;
    }
    _go(2);
    await for (final steps in _provisioning.dryRunSetup(_draft)) {
      if (!mounted) return;
      setState(() => _steps = steps);
    }
    setState(() {
      _setupState = MobileSetupState(
        primaryDomain: _draft.normalizedDomain,
        scriptName: _draft.effectiveScriptName,
        workerUrl: 'https://${_draft.effectiveScriptName}.workers.dev',
        dashboardUrl: 'https://${_draft.effectiveScriptName}.workers.dev/app',
        botUsername: 'connect-after-api-port',
        domains: <String>[_draft.normalizedDomain],
      );
    });
    _go(3);
  }

  void _showSnack(String message) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: <Color>[Color(0xFFFFFBEA), Color(0xFFFFE082), Color(0xFFFFB300)],
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
                      hideSecrets: _hideSecrets,
                      onToggleSave: (value) => setState(() => _saveCredentials = value),
                      onToggleSecretMode: () => setState(() => _hideSecrets = !_hideSecrets),
                      onBack: () => _go(0),
                      onSubmit: _runDrySetup,
                    ),
                    _ProgressStep(steps: _steps),
                    _DashboardStep(
                      state: _setupState,
                      onAddDomain: () => _go(4),
                      onReset: () => _go(1),
                    ),
                    _AddDomainStep(
                      primaryDomain: _setupState?.primaryDomain ?? _draft.normalizedDomain,
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
    return Container(
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
    required this.hideSecrets,
    required this.onToggleSave,
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
  final bool hideSecrets;
  final ValueChanged<bool> onToggleSave;
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
            const Text('Credential tidak boleh dikirim ke server pihak ketiga. Next phase: simpan dengan Android secure storage.'),
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
              subtitle: const Text('Default off sampai secure storage selesai.'),
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
                Expanded(child: FilledButton(onPressed: onSubmit, child: const Text('Dry setup'))),
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
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: Icon(icon, color: color),
      title: Text(step.title, style: const TextStyle(fontWeight: FontWeight.w800)),
      subtitle: step.detail.isEmpty ? null : Text(step.detail),
    );
  }
}

class _DashboardStep extends StatelessWidget {
  const _DashboardStep({required this.state, required this.onAddDomain, required this.onReset});

  final MobileSetupState? state;
  final VoidCallback onAddDomain;
  final VoidCallback onReset;

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
          ],
          const Spacer(),
          FilledButton.icon(onPressed: onAddDomain, icon: const Icon(Icons.add_link), label: const Text('Tambah domain')),
          const SizedBox(height: 8),
          OutlinedButton.icon(onPressed: onReset, icon: const Icon(Icons.settings), label: const Text('Edit setup')),
        ],
      ),
    );
  }
}

class _AddDomainStep extends StatefulWidget {
  const _AddDomainStep({required this.primaryDomain, required this.onBack});

  final String primaryDomain;
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
            onPressed: () {
              final domain = InputValidators.normalizeDomain(_domainController.text);
              final valid = InputValidators.isDomain(domain);
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text(valid ? 'Next phase: add-domain API untuk $domain' : 'Domain tidak valid')),
              );
            },
            icon: const Icon(Icons.play_arrow_rounded),
            label: const Text('Dry add-domain'),
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
