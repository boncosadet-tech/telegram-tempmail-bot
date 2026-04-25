import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/models/setup_models.dart';
import '../../core/theme/app_design.dart';
import '../../services/email_compose_service.dart';
import '../../services/inbox_service.dart';
import '../../services/notification_service.dart';
import '../../services/otp_history_service.dart';
import '../../services/toast_service.dart';

class InboxPanel extends StatefulWidget {
  const InboxPanel(
      {super.key,
      required this.state,
      required this.credentials,
      required this.onOpenUrl,
      required this.onCopyText,
      required this.onSaveCredentials});

  final MobileSetupState state;
  final StoredCredentials? credentials;
  final ValueChanged<String> onOpenUrl;
  final ValueChanged<String> onCopyText;
  final VoidCallback onSaveCredentials;

  @override
  State<InboxPanel> createState() => _InboxPanelState();
}

class _InboxPanelState extends State<InboxPanel> {
  final InboxService _inbox = const InboxService();
  final EmailComposeService _compose = const EmailComposeService();
  final ToastService _toast = const ToastService();
  final OtpHistoryService _otpHistory = OtpHistoryService();
  final TextEditingController _searchController = TextEditingController();
  List<InboxMessage> _messages = const <InboxMessage>[];
  bool _loading = false;
  String _error = '';
  bool _showOtpHistory = false;

  @override
  void initState() {
    super.initState();
    _searchController.addListener(() {
      if (mounted) setState(() {});
    });
    _refresh();
  }

  @override
  void didUpdateWidget(covariant InboxPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.credentials == null && widget.credentials != null) _refresh();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  List<InboxMessage> get _filteredMessages {
    final query = _searchController.text.trim().toLowerCase();
    if (query.isEmpty) return _messages;
    return _messages
        .where((message) =>
            message.sender.toLowerCase().contains(query) ||
            message.subject.toLowerCase().contains(query) ||
            message.previewText.toLowerCase().contains(query) ||
            message.aliasFull.toLowerCase().contains(query) ||
            message.otpCode.toLowerCase().contains(query))
        .toList(growable: false);
  }

  Future<void> _refresh() async {
    final credentials = widget.credentials;
    if (credentials == null) return;
    setState(() {
      _loading = true;
      _error = '';
    });
    try {
      final messages = await _inbox.listMessages(
          state: widget.state, credentials: credentials);
      if (!mounted) return;

      // Detect new emails since last refresh
      final previousIds = _messages.map((m) => m.id).toSet();
      final newEmails =
          messages.where((m) => !previousIds.contains(m.id)).toList();

      // Process OTP history and auto-copy new OTPs
      final newOtps = _otpHistory.processMessages(messages);
      final notifier = NotificationService.instance;
      for (final otp in newOtps) {
        await Clipboard.setData(ClipboardData(text: otp.code));
        await _toast.otpDetected(otp.code);
        await notifier.showOtpNotification(code: otp.code, sender: otp.sender);
      }

      // Notify about non-OTP new emails
      final nonOtpNew = newEmails.where((m) => !m.isOtp).toList();
      if (nonOtpNew.isNotEmpty && _messages.isNotEmpty) {
        await notifier.showEmailNotification(
          sender: nonOtpNew.first.sender,
          subject: nonOtpNew.first.subject,
          count: nonOtpNew.length,
        );
      }
      if (!mounted) return;

      setState(() {
        _messages = messages;
        _loading = false;
      });
    } on Object catch (error) {
      if (!mounted) return;
      setState(() {
        _error = _humanizeInboxError(error.toString());
        _loading = false;
      });
    }
  }

  Future<void> _deleteMessage(InboxMessage message) async {
    final credentials = widget.credentials;
    if (credentials == null) return;
    try {
      await _inbox.deleteMessage(
          state: widget.state, credentials: credentials, id: message.id);
      if (!mounted) return;
      setState(() =>
          _messages = _messages.where((m) => m.id != message.id).toList());
    } on Object catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('Delete gagal: $error')));
    }
  }

  Future<void> _purgeOtp() async {
    final credentials = widget.credentials;
    if (credentials == null) return;
    setState(() => _loading = true);
    try {
      await _inbox.purgeOtp(state: widget.state, credentials: credentials);
      if (!mounted) return;
      setState(() =>
          _messages = _messages.where((m) => !m.isOtp).toList(growable: false));
    } on Object catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('Purge OTP gagal: $error')));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _openDetail(InboxMessage message) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (sheetContext) {
        return _InboxDetailSheet(
          message: message,
          onCopyText: widget.onCopyText,
          onDelete: () async {
            Navigator.of(sheetContext).pop();
            await _deleteMessage(message);
          },
          onReply: () async {
            Navigator.of(sheetContext).pop();
            try {
              await _compose.reply(
                to: message.sender,
                subject: message.subject,
                body:
                    '\n\n--- Original Message ---\nFrom: ${message.sender}\nDate: ${message.receivedAt}\n\n${message.previewText}',
              );
            } on Object catch (e) {
              if (!mounted) return;
              await _toast.error('Could not open email client: $e');
            }
          },
          onForward: () async {
            Navigator.of(sheetContext).pop();
            try {
              await _compose.forward(
                subject: message.subject,
                body:
                    '\n\n--- Forwarded Message ---\nFrom: ${message.sender}\nDate: ${message.receivedAt}\nSubject: ${message.subject}\n\n${message.previewText}',
              );
            } on Object catch (e) {
              if (!mounted) return;
              await _toast.error('Could not open email client: $e');
            }
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final credentials = widget.credentials;
    final filtered = _filteredMessages;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        _InboxHeader(
          domain: widget.state.primaryDomain,
          messageCount: _messages.length,
          loading: _loading,
          hasCredentials: credentials != null,
          otpCount: _otpHistory.count,
          showOtpHistory: _showOtpHistory,
          onRefresh: credentials == null || _loading ? null : _refresh,
          onOpenDashboard: () => widget.onOpenUrl(widget.state.dashboardUrl),
          onPurgeOtp: credentials == null || _loading ? null : _purgeOtp,
          onToggleOtpHistory: credentials == null
              ? null
              : () => setState(() => _showOtpHistory = !_showOtpHistory),
        ),
        const SizedBox(height: 12),
        if (credentials == null)
          _LockedInboxPanel(
              onSaveCredentials: widget.onSaveCredentials,
              onOpenDashboard: () =>
                  widget.onOpenUrl(widget.state.dashboardUrl))
        else if (_showOtpHistory)
          _OtpHistoryPanel(
            entries: _otpHistory.entries,
            onCopy: (code) async {
              await Clipboard.setData(ClipboardData(text: code));
              await _toast.copied('OTP');
            },
            onClear: () {
              _otpHistory.clear();
              setState(() {});
            },
          )
        else ...<Widget>[
          _InboxSearchField(controller: _searchController, enabled: !_loading),
          const SizedBox(height: 12),
          if (_loading && _messages.isEmpty)
            const _InboxSkeletonList()
          else if (_error.isNotEmpty)
            _InboxErrorPanel(message: _error, onRetry: _refresh)
          else if (_messages.isEmpty)
            _InboxEmptyState(onRefresh: _refresh)
          else if (filtered.isEmpty)
            _InboxEmptyState(
                text: 'No emails match your search.', onRefresh: _refresh)
          else
            Column(
              children: <Widget>[
                for (final message in filtered.take(12))
                  _InboxEmailCard(
                      message: message, onTap: () => _openDetail(message)),
                if (filtered.length > 12) ...<Widget>[
                  const SizedBox(height: 4),
                  Text(
                      '${filtered.length - 12} more emails hidden. Use search to narrow down.',
                      style: AppText.caption),
                ],
              ],
            ),
          const SizedBox(height: 16),
          Align(
            alignment: Alignment.centerRight,
            child: FloatingActionButton.extended(
              heroTag: 'compose_email',
              onPressed: () async {
                try {
                  await _compose.compose();
                } on Object catch (e) {
                  if (!mounted) return;
                  await _toast.error('Could not open email client: $e');
                }
              },
              backgroundColor: AppColors.primary,
              foregroundColor: AppColors.onPrimary,
              icon: const Icon(Icons.edit_rounded, size: 20),
              label: const Text('Compose'),
            ),
          ),
        ],
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Inbox header — Gmail/ProtonMail-style
// ---------------------------------------------------------------------------

class _InboxHeader extends StatelessWidget {
  const _InboxHeader({
    required this.domain,
    required this.messageCount,
    required this.loading,
    required this.hasCredentials,
    required this.otpCount,
    required this.showOtpHistory,
    required this.onRefresh,
    required this.onOpenDashboard,
    required this.onPurgeOtp,
    required this.onToggleOtpHistory,
  });

  final String domain;
  final int messageCount;
  final bool loading;
  final bool hasCredentials;
  final int otpCount;
  final bool showOtpHistory;
  final VoidCallback? onRefresh;
  final VoidCallback onOpenDashboard;
  final VoidCallback? onPurgeOtp;
  final VoidCallback? onToggleOtpHistory;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).colorScheme.brightness == Brightness.dark;
    return Row(
      children: <Widget>[
        Container(
          width: 32,
          height: 32,
          decoration: const BoxDecoration(
            color: AppColors.primary,
            shape: BoxShape.circle,
          ),
          child: Icon(
              showOtpHistory ? Icons.password_rounded : Icons.inbox_rounded,
              color: AppColors.onPrimary,
              size: 16),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(showOtpHistory ? 'OTP History' : 'Inbox', style: AppText.h2),
              Text(
                  showOtpHistory
                      ? '$otpCount codes detected'
                      : hasCredentials
                          ? '$messageCount emails · $domain'
                          : 'Credential required · $domain',
                  style: AppText.caption),
            ],
          ),
        ),
        if (hasCredentials && otpCount > 0)
          _OtpBadgeButton(
            count: otpCount,
            active: showOtpHistory,
            onTap: onToggleOtpHistory,
          ),
        if (loading)
          const SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(
                  strokeWidth: 2, color: AppColors.primary)),
        PopupMenuButton<String>(
          tooltip: 'Inbox actions',
          icon: Icon(Icons.more_vert_rounded,
              color:
                  dark ? AppColors.darkTextSecondary : AppColors.textSecondary,
              size: 22),
          onSelected: (value) {
            if (value == 'refresh') onRefresh?.call();
            if (value == 'dashboard') onOpenDashboard();
            if (value == 'purge') onPurgeOtp?.call();
            if (value == 'otp_history') onToggleOtpHistory?.call();
          },
          itemBuilder: (context) => <PopupMenuEntry<String>>[
            PopupMenuItem<String>(
                value: 'refresh',
                enabled: onRefresh != null,
                child: const Text('Refresh inbox')),
            const PopupMenuItem<String>(
                value: 'dashboard', child: Text('Open web dashboard')),
            PopupMenuItem<String>(
                value: 'otp_history',
                enabled: onToggleOtpHistory != null,
                child: Text(showOtpHistory ? 'Show inbox' : 'OTP history')),
            PopupMenuItem<String>(
                value: 'purge',
                enabled: onPurgeOtp != null,
                child: const Text('Purge OTP emails')),
          ],
        ),
      ],
    );
  }
}

class _OtpBadgeButton extends StatelessWidget {
  const _OtpBadgeButton({
    required this.count,
    required this.active,
    required this.onTap,
  });

  final int count;
  final bool active;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: 4),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          decoration: BoxDecoration(
            color: active
                ? AppColors.success
                : AppColors.success.withValues(alpha: .1),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Icon(Icons.password_rounded,
                  size: 14, color: active ? Colors.white : AppColors.success),
              const SizedBox(width: 4),
              Text('$count',
                  style: AppText.caption.copyWith(
                      color: active ? Colors.white : AppColors.success,
                      fontWeight: FontWeight.w700)),
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Search — Gmail-style pill search bar
// ---------------------------------------------------------------------------

class _InboxSearchField extends StatelessWidget {
  const _InboxSearchField({required this.controller, required this.enabled});

  final TextEditingController controller;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      enabled: enabled,
      textInputAction: TextInputAction.search,
      decoration: InputDecoration(
        prefixIcon: const Icon(Icons.search_rounded, size: 20),
        suffixIcon: controller.text.isEmpty
            ? null
            : IconButton(
                tooltip: 'Clear search',
                onPressed: controller.clear,
                icon: const Icon(Icons.close_rounded, size: 20),
              ),
        labelText: 'Search inbox',
        helperText: 'Search by sender, subject, alias, preview, or OTP',
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Locked state — ProtonMail-style
// ---------------------------------------------------------------------------

class _LockedInboxPanel extends StatelessWidget {
  const _LockedInboxPanel(
      {required this.onSaveCredentials, required this.onOpenDashboard});

  final VoidCallback onSaveCredentials;
  final VoidCallback onOpenDashboard;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).colorScheme.brightness == Brightness.dark;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: dark ? AppColors.darkSurface : AppColors.surface,
        borderRadius: BorderRadius.circular(AppSpacing.radius),
        boxShadow: AppShadows.card,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: AppColors.warning.withValues(alpha: .1),
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.lock_rounded,
                    color: AppColors.warning, size: 18),
              ),
              const SizedBox(width: 10),
              Expanded(
                  child: Text('Native inbox locked',
                      style:
                          AppText.body.copyWith(fontWeight: FontWeight.w700))),
            ],
          ),
          const SizedBox(height: 10),
          const Text(
              'Save encrypted Cloudflare credentials on device to read D1 directly. You can still use the web dashboard as fallback.',
              style: AppText.caption),
          const SizedBox(height: 14),
          Row(
            children: <Widget>[
              Expanded(
                  child: FilledButton(
                      onPressed: onSaveCredentials,
                      child: const Text('Save credentials'))),
              const SizedBox(width: 8),
              Expanded(
                  child: OutlinedButton(
                      onPressed: onOpenDashboard,
                      child: const Text('Web dashboard'))),
            ],
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Email card — Gmail-style row with circular avatar
// ---------------------------------------------------------------------------

class _InboxEmailCard extends StatelessWidget {
  const _InboxEmailCard({required this.message, required this.onTap});

  final InboxMessage message;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final subject = message.subject.trim().isEmpty
        ? '(no subject)'
        : message.subject.trim();
    final preview = message.previewText.trim().isEmpty
        ? 'No preview available'
        : message.previewText.trim();
    final dark = Theme.of(context).colorScheme.brightness == Brightness.dark;
    return Padding(
      padding: const EdgeInsets.only(bottom: 2),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(AppSpacing.radius),
          hoverColor: dark ? AppColors.darkHover : AppColors.hover,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                _SenderAvatar(sender: message.sender, isOtp: message.isOtp),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Row(
                        children: <Widget>[
                          Expanded(
                              child: Text(_senderName(message.sender),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: AppText.body
                                      .copyWith(fontWeight: FontWeight.w700))),
                          const SizedBox(width: 8),
                          Text(_formatInboxTime(message.receivedAt),
                              style: AppText.caption),
                        ],
                      ),
                      const SizedBox(height: 2),
                      Text(subject,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: AppText.body
                              .copyWith(fontWeight: FontWeight.w600)),
                      const SizedBox(height: 2),
                      Text(preview,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: AppText.caption),
                      if (message.isOtp ||
                          message.aliasFull.isNotEmpty) ...<Widget>[
                        const SizedBox(height: 8),
                        Wrap(
                          spacing: 6,
                          runSpacing: 6,
                          children: <Widget>[
                            _InboxTag(
                                text: message.aliasFull, color: AppColors.info),
                            if (message.isOtp)
                              _InboxTag(
                                  text: message.otpCode == '-'
                                      ? 'OTP'
                                      : 'OTP ${message.otpCode}',
                                  color: AppColors.success),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _SenderAvatar extends StatelessWidget {
  const _SenderAvatar({required this.sender, required this.isOtp});

  final String sender;
  final bool isOtp;

  static const _avatarColors = <Color>[
    AppColors.primary,
    AppColors.info,
    AppColors.success,
    Color(0xFFE040FB),
    Color(0xFFFF6D00),
    Color(0xFF00BFA5),
  ];

  @override
  Widget build(BuildContext context) {
    final initial = _senderInitial(sender);
    final colorIndex = sender.hashCode.abs() % _avatarColors.length;
    final color = isOtp ? AppColors.success : _avatarColors[colorIndex];
    return Container(
      width: 40,
      height: 40,
      decoration: BoxDecoration(
        color: color.withValues(alpha: .15),
        shape: BoxShape.circle,
      ),
      child: Center(
          child: Text(initial,
              style: AppText.body.copyWith(
                  fontWeight: FontWeight.w700, color: color, fontSize: 15))),
    );
  }
}

// ---------------------------------------------------------------------------
// Detail bottom sheet — ProtonMail-style
// ---------------------------------------------------------------------------

class _InboxDetailSheet extends StatelessWidget {
  const _InboxDetailSheet(
      {required this.message,
      required this.onCopyText,
      required this.onDelete,
      required this.onReply,
      required this.onForward});

  final InboxMessage message;
  final ValueChanged<String> onCopyText;
  final VoidCallback onReply;
  final VoidCallback onForward;
  final Future<void> Function() onDelete;

  @override
  Widget build(BuildContext context) {
    final body = message.renderedHtml.isNotEmpty
        ? _stripHtml(message.renderedHtml)
        : message.previewText;
    final dark = Theme.of(context).colorScheme.brightness == Brightness.dark;
    return DraggableScrollableSheet(
      initialChildSize: .78,
      minChildSize: .45,
      maxChildSize: .95,
      builder: (context, controller) {
        return Container(
          decoration: BoxDecoration(
            color: dark ? AppColors.darkSurface : AppColors.surface,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
            boxShadow: AppShadows.elevated,
          ),
          child: ListView(
            controller: controller,
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
            children: <Widget>[
              Center(
                child: Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                        color: dark ? AppColors.darkBorder : AppColors.border,
                        borderRadius: BorderRadius.circular(999))),
              ),
              const SizedBox(height: 18),
              Row(
                children: <Widget>[
                  _SenderAvatar(sender: message.sender, isOtp: message.isOtp),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(_senderName(message.sender),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: AppText.body
                                .copyWith(fontWeight: FontWeight.w700)),
                        Text(_formatInboxTime(message.receivedAt),
                            style: AppText.caption),
                      ],
                    ),
                  ),
                  IconButton(
                      onPressed: () => Navigator.of(context).pop(),
                      icon: Icon(Icons.close_rounded,
                          size: 22,
                          color: dark
                              ? AppColors.darkTextSecondary
                              : AppColors.textSecondary)),
                ],
              ),
              const SizedBox(height: 16),
              Text(
                  message.subject.trim().isEmpty
                      ? '(no subject)'
                      : message.subject.trim(),
                  style: AppText.h2),
              const SizedBox(height: 12),
              _SheetInfoRow(label: 'To', value: message.aliasFull),
              _SheetInfoRow(label: 'From', value: message.sender),
              if (message.isOtp) ...<Widget>[
                const SizedBox(height: 6),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppColors.success.withValues(alpha: .08),
                    borderRadius: BorderRadius.circular(AppSpacing.radius),
                  ),
                  child: Row(
                    children: <Widget>[
                      Container(
                        width: 32,
                        height: 32,
                        decoration: BoxDecoration(
                          color: AppColors.success.withValues(alpha: .15),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(Icons.password_rounded,
                            color: AppColors.success, size: 16),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                          child: Text(
                              message.otpCode == '-'
                                  ? 'OTP detected'
                                  : message.otpCode,
                              style: AppText.body.copyWith(
                                  color: AppColors.success,
                                  fontWeight: FontWeight.w700))),
                      TextButton(
                          onPressed: message.otpCode == '-'
                              ? null
                              : () => onCopyText(message.otpCode),
                          child: const Text('Copy')),
                    ],
                  ),
                ),
              ],
              const SizedBox(height: 16),
              Text('MESSAGE',
                  style: AppText.label.copyWith(color: AppColors.primary)),
              const SizedBox(height: 8),
              SelectableText(body.isEmpty ? '(no preview)' : body,
                  style: AppText.body),
              const SizedBox(height: 20),
              Row(
                children: <Widget>[
                  Expanded(
                      child: OutlinedButton.icon(
                          onPressed: onReply,
                          icon: const Icon(Icons.reply_rounded, size: 18),
                          label: const Text('Reply'))),
                  const SizedBox(width: 8),
                  Expanded(
                      child: OutlinedButton.icon(
                          onPressed: onForward,
                          icon: const Icon(Icons.forward_rounded, size: 18),
                          label: const Text('Forward'))),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: <Widget>[
                  Expanded(
                      child: OutlinedButton(
                          onPressed: () => onCopyText(message.aliasFull),
                          child: const Text('Copy To'))),
                  const SizedBox(width: 8),
                  Expanded(
                      child: FilledButton(
                          style: FilledButton.styleFrom(
                              backgroundColor: AppColors.error),
                          onPressed: onDelete,
                          child: const Text('Delete'))),
                ],
              ),
            ],
          ),
        );
      },
    );
  }
}

class _SheetInfoRow extends StatelessWidget {
  const _SheetInfoRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          SizedBox(
              width: 48,
              child: Text(label.toUpperCase(), style: AppText.label)),
          Expanded(child: SelectableText(value, style: AppText.body)),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// OTP History panel
// ---------------------------------------------------------------------------

class _OtpHistoryPanel extends StatelessWidget {
  const _OtpHistoryPanel({
    required this.entries,
    required this.onCopy,
    required this.onClear,
  });

  final List<OtpHistoryEntry> entries;
  final ValueChanged<String> onCopy;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).colorScheme.brightness == Brightness.dark;
    if (entries.isEmpty) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: dark ? AppColors.darkSurface : AppColors.surface,
          borderRadius: BorderRadius.circular(AppSpacing.radius),
          boxShadow: AppShadows.card,
        ),
        child: Column(
          children: <Widget>[
            Container(
              width: 48,
              height: 48,
              decoration: BoxDecoration(
                color: AppColors.success.withValues(alpha: .1),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.password_rounded,
                  color: AppColors.success, size: 24),
            ),
            const SizedBox(height: 12),
            const Text('No OTP codes detected yet', style: AppText.body),
            const SizedBox(height: 4),
            const Text(
                'OTP codes from incoming emails will appear here automatically.',
                style: AppText.caption,
                textAlign: TextAlign.center),
          ],
        ),
      );
    }

    return Column(
      children: <Widget>[
        for (final entry in entries)
          _OtpHistoryCard(entry: entry, onCopy: onCopy),
        const SizedBox(height: 8),
        TextButton.icon(
          onPressed: onClear,
          icon: const Icon(Icons.delete_sweep_rounded, size: 18),
          label: const Text('Clear history'),
          style: TextButton.styleFrom(foregroundColor: AppColors.error),
        ),
      ],
    );
  }
}

class _OtpHistoryCard extends StatelessWidget {
  const _OtpHistoryCard({required this.entry, required this.onCopy});

  final OtpHistoryEntry entry;
  final ValueChanged<String> onCopy;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).colorScheme.brightness == Brightness.dark;
    final age = DateTime.now().difference(entry.detectedAt);
    final timeLabel = age.inMinutes < 1
        ? 'just now'
        : age.inMinutes < 60
            ? '${age.inMinutes}m ago'
            : age.inHours < 24
                ? '${age.inHours}h ago'
                : '${age.inDays}d ago';

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: dark ? AppColors.darkSurface : AppColors.surface,
          borderRadius: BorderRadius.circular(AppSpacing.radius),
          boxShadow: AppShadows.card,
        ),
        child: Row(
          children: <Widget>[
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: AppColors.success.withValues(alpha: .12),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.lock_rounded,
                  color: AppColors.success, size: 20),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Row(
                    children: <Widget>[
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 8, vertical: 2),
                        decoration: BoxDecoration(
                          color: AppColors.success.withValues(alpha: .1),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(entry.code,
                            style: AppText.body.copyWith(
                                fontWeight: FontWeight.w800,
                                color: AppColors.success,
                                fontSize: 16,
                                letterSpacing: 2)),
                      ),
                      const SizedBox(width: 8),
                      Text(timeLabel, style: AppText.caption),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _senderName(entry.sender),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppText.caption,
                  ),
                  if (entry.subject.isNotEmpty)
                    Text(entry.subject,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppText.caption),
                ],
              ),
            ),
            IconButton(
              onPressed: () => onCopy(entry.code),
              icon: const Icon(Icons.copy_rounded, size: 20),
              tooltip: 'Copy OTP',
              color: AppColors.primary,
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

class _InboxSkeletonList extends StatelessWidget {
  const _InboxSkeletonList();

  @override
  Widget build(BuildContext context) {
    return const Column(children: <Widget>[
      _SkeletonEmailCard(),
      _SkeletonEmailCard(),
      _SkeletonEmailCard()
    ]);
  }
}

class _SkeletonEmailCard extends StatelessWidget {
  const _SkeletonEmailCard();

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).colorScheme.brightness == Brightness.dark;
    final shimmer =
        dark ? AppColors.darkSurfaceVariant : AppColors.surfaceVariant;
    return Container(
      margin: const EdgeInsets.only(bottom: 4),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      child: Row(
        children: <Widget>[
          Container(
              width: 40,
              height: 40,
              decoration:
                  BoxDecoration(color: shimmer, shape: BoxShape.circle)),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Container(
                    width: double.infinity,
                    height: 10,
                    decoration: BoxDecoration(
                        color: shimmer,
                        borderRadius: BorderRadius.circular(4))),
                const SizedBox(height: 6),
                Container(
                    width: 160,
                    height: 8,
                    decoration: BoxDecoration(
                        color: shimmer,
                        borderRadius: BorderRadius.circular(4))),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _InboxEmptyState extends StatelessWidget {
  const _InboxEmptyState(
      {this.text = 'No emails in native inbox yet.', required this.onRefresh});

  final String text;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).colorScheme.brightness == Brightness.dark;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 28),
      decoration: BoxDecoration(
        color: dark ? AppColors.darkSurface : AppColors.surface,
        borderRadius: BorderRadius.circular(AppSpacing.radius),
        boxShadow: AppShadows.card,
      ),
      child: Column(
        children: <Widget>[
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: AppColors.primary.withValues(alpha: .1),
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.inbox_outlined,
                color: AppColors.primary, size: 24),
          ),
          const SizedBox(height: 12),
          Text(text,
              textAlign: TextAlign.center,
              style: AppText.body.copyWith(fontWeight: FontWeight.w600)),
          const SizedBox(height: 4),
          const Text('Send a test email to your alias then refresh.',
              textAlign: TextAlign.center, style: AppText.caption),
          const SizedBox(height: 12),
          OutlinedButton(onPressed: onRefresh, child: const Text('Refresh')),
        ],
      ),
    );
  }
}

class _InboxErrorPanel extends StatelessWidget {
  const _InboxErrorPanel({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.error.withValues(alpha: .05),
        borderRadius: BorderRadius.circular(AppSpacing.radius),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(children: <Widget>[
            Container(
              width: 32,
              height: 32,
              decoration: BoxDecoration(
                color: AppColors.error.withValues(alpha: .1),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.error_outline_rounded,
                  color: AppColors.error, size: 18),
            ),
            const SizedBox(width: 10),
            Expanded(
                child: Text('Inbox error',
                    style: AppText.body.copyWith(fontWeight: FontWeight.w700))),
          ]),
          const SizedBox(height: 8),
          Text(message, style: AppText.caption),
          const SizedBox(height: 12),
          OutlinedButton(onPressed: onRetry, child: const Text('Retry')),
        ],
      ),
    );
  }
}

class _InboxTag extends StatelessWidget {
  const _InboxTag({required this.text, required this.color});

  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
          color: color.withValues(alpha: .1),
          borderRadius: BorderRadius.circular(12)),
      child: Text(text,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: AppText.caption.copyWith(
              color: color, fontWeight: FontWeight.w600, fontSize: 11)),
    );
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

String _senderInitial(String sender) {
  final cleaned = _senderName(sender).trim();
  if (cleaned.isEmpty || cleaned == '-') return '?';
  return cleaned.substring(0, 1).toUpperCase();
}

String _senderName(String sender) {
  final trimmed = sender.trim();
  if (trimmed.isEmpty) return '-';
  final emailMatch = RegExp(r'<([^>]+)>').firstMatch(trimmed);
  if (emailMatch != null) return emailMatch.group(1) ?? trimmed;
  return trimmed.replaceAll(RegExp(r'\s+'), ' ');
}

String _formatInboxTime(DateTime value) {
  if (value.millisecondsSinceEpoch == 0) return '-';
  final now = DateTime.now();
  final diff = now.difference(value);
  if (diff.inMinutes < 1) return 'now';
  if (diff.inMinutes < 60) return '${diff.inMinutes}m';
  if (diff.inHours < 24) return '${diff.inHours}h';
  if (diff.inDays < 7) return '${diff.inDays}d';
  return '${value.year}-${value.month.toString().padLeft(2, '0')}-${value.day.toString().padLeft(2, '0')}';
}

String _stripHtml(String raw) {
  return raw
      .replaceAll(RegExp(r'<br\s*/?>', caseSensitive: false), '\n')
      .replaceAll(RegExp(r'</p>', caseSensitive: false), '\n')
      .replaceAll(RegExp(r'<[^>]+>'), ' ')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
}

String _humanizeInboxError(String raw) {
  final text = raw.replaceFirst('Exception: ', '');
  if (text.contains('D1') || text.contains('database'))
    return 'Inbox D1 belum siap atau credential Cloudflare tidak punya akses.';
  if (text.contains('401') ||
      text.contains('403') ||
      text.contains('unauthorized'))
    return 'Credential Cloudflare ditolak. Simpan ulang Global API Key.';
  if (text.length > 150) return '${text.substring(0, 150)}…';
  return text;
}
