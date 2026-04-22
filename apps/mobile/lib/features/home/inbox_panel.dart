import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/models/setup_models.dart';
import '../../core/theme/app_design.dart';
import '../../services/inbox_service.dart';

class InboxPanel extends StatefulWidget {
  const InboxPanel({
    super.key,
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
  State<InboxPanel> createState() => _InboxPanelState();
}

class _InboxPanelState extends State<InboxPanel> {
  final InboxService _inbox = const InboxService();
  final TextEditingController _searchController = TextEditingController();
  List<InboxMessage> _messages = const <InboxMessage>[];
  bool _loading = false;
  String _error = '';
  String _query = '';

  List<InboxMessage> get _filteredMessages {
    final query = _query.trim().toLowerCase();
    if (query.isEmpty) return _messages;
    return _messages.where((message) {
      return message.sender.toLowerCase().contains(query) ||
          message.subject.toLowerCase().contains(query) ||
          message.aliasFull.toLowerCase().contains(query) ||
          message.previewText.toLowerCase().contains(query) ||
          message.otpCode.toLowerCase().contains(query);
    }).toList(growable: false);
  }

  @override
  void initState() {
    super.initState();
    _searchController.addListener(() => setState(() => _query = _searchController.text));
    if (widget.credentials != null) unawaited(_refresh());
  }

  @override
  void didUpdateWidget(covariant InboxPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.credentials == null && widget.credentials != null) unawaited(_refresh());
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
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
      setState(() => _messages = messages);
    } on Object catch (error) {
      if (!mounted) return;
      setState(() => _error = _humanizeInboxError(error.toString()));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _deleteMessage(InboxMessage message) async {
    final credentials = widget.credentials;
    if (credentials == null) return;
    final confirmed = await _confirmDestructive(
      title: 'Delete email?',
      message: 'Email "${message.subject}" akan dihapus permanen dari D1 inbox.',
      actionLabel: 'Delete',
    );
    if (!confirmed) return;
    setState(() => _loading = true);
    try {
      await _inbox.deleteMessage(state: widget.state, credentials: credentials, id: message.id);
      if (!mounted) return;
      setState(() => _messages = _messages.where((item) => item.id != message.id).toList(growable: false));
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Email deleted.')));
    } on Object catch (error) {
      if (!mounted) return;
      setState(() => _error = _humanizeInboxError(error.toString()));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _purgeOtp() async {
    final credentials = widget.credentials;
    if (credentials == null) return;
    final confirmed = await _confirmDestructive(
      title: 'Purge OTP emails?',
      message: 'Semua email OTP akan dihapus dari D1. Aksi ini tidak bisa di-undo.',
      actionLabel: 'Purge OTP',
    );
    if (!confirmed) return;
    setState(() => _loading = true);
    try {
      await _inbox.purgeOtp(state: widget.state, credentials: credentials);
      await _refresh();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('OTP history purged.')));
    } on Object catch (error) {
      if (!mounted) return;
      setState(() => _error = _humanizeInboxError(error.toString()));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<bool> _confirmDestructive({required String title, required String message, required String actionLabel}) async {
    final result = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: <Widget>[
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.error),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(actionLabel),
          ),
        ],
      ),
    );
    return result ?? false;
  }

  void _openDetail(InboxMessage message) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (sheetContext) {
        return _InboxDetailSheet(
          message: message,
          onCopyText: widget.onCopyText,
          onDelete: () async {
            Navigator.of(sheetContext).pop();
            await _deleteMessage(message);
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final credentials = widget.credentials;
    final filtered = _filteredMessages;
    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.section),
      padding: const EdgeInsets.all(AppSpacing.card),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.brightness == Brightness.dark ? AppColors.darkSurface : AppColors.surface,
        borderRadius: BorderRadius.circular(AppSpacing.radius),
        border: Border.all(color: credentials == null ? AppColors.warning.withValues(alpha: .35) : AppColors.border),
        boxShadow: Theme.of(context).colorScheme.brightness == Brightness.dark ? const <BoxShadow>[] : AppShadows.card,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          _InboxHeader(
            domain: widget.state.primaryDomain,
            messageCount: _messages.length,
            loading: _loading,
            hasCredentials: credentials != null,
            onRefresh: credentials == null || _loading ? null : _refresh,
            onOpenDashboard: () => widget.onOpenUrl(widget.state.dashboardUrl),
            onPurgeOtp: credentials == null || _loading ? null : _purgeOtp,
          ),
          const SizedBox(height: 14),
          if (credentials == null)
            _LockedInboxPanel(onSaveCredentials: widget.onSaveCredentials, onOpenDashboard: () => widget.onOpenUrl(widget.state.dashboardUrl))
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
              _InboxEmptyState(text: 'Tidak ada email yang cocok dengan pencarian.', onRefresh: _refresh)
            else
              Column(
                children: <Widget>[
                  for (final message in filtered.take(12)) _InboxEmailCard(message: message, onTap: () => _openDetail(message)),
                  if (filtered.length > 12) ...<Widget>[
                    const SizedBox(height: 6),
                    Text('${filtered.length - 12} email lain disembunyikan. Gunakan search untuk mempersempit.', style: AppText.caption),
                  ],
                ],
              ),
          ],
        ],
      ),
    );
  }
}

class _InboxHeader extends StatelessWidget {
  const _InboxHeader({
    required this.domain,
    required this.messageCount,
    required this.loading,
    required this.hasCredentials,
    required this.onRefresh,
    required this.onOpenDashboard,
    required this.onPurgeOtp,
  });

  final String domain;
  final int messageCount;
  final bool loading;
  final bool hasCredentials;
  final VoidCallback? onRefresh;
  final VoidCallback onOpenDashboard;
  final VoidCallback? onPurgeOtp;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: <Color>[AppColors.primary.withValues(alpha: .18), AppColors.primary.withValues(alpha: .05)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.primary.withValues(alpha: .22)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(color: AppColors.primary, borderRadius: BorderRadius.circular(14)),
                child: const Icon(Icons.inbox_rounded, color: AppColors.onPrimary),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text('Inbox', style: AppText.h2.copyWith(fontSize: 21)),
                    const SizedBox(height: 2),
                    Text(hasCredentials ? '$messageCount email • $domain' : 'Credential required • $domain', style: AppText.caption),
                  ],
                ),
              ),
              if (loading) const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2.4)),
              PopupMenuButton<String>(
                tooltip: 'Inbox actions',
                onSelected: (value) {
                  if (value == 'refresh') onRefresh?.call();
                  if (value == 'dashboard') onOpenDashboard();
                  if (value == 'purge') onPurgeOtp?.call();
                },
                itemBuilder: (context) => <PopupMenuEntry<String>>[
                  PopupMenuItem<String>(value: 'refresh', enabled: onRefresh != null, child: const Text('Refresh inbox')),
                  const PopupMenuItem<String>(value: 'dashboard', child: Text('Open web dashboard')),
                  PopupMenuItem<String>(value: 'purge', enabled: onPurgeOtp != null, child: const Text('Purge OTP history')),
                ],
              ),
            ],
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: <Widget>[
              _InboxChip(text: hasCredentials ? 'Native D1 active' : 'Locked', color: hasCredentials ? AppColors.success : AppColors.warning),
              const _InboxChip(text: 'Web fallback ready', color: AppColors.blue),
            ],
          ),
        ],
      ),
    );
  }
}

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
        prefixIcon: const Icon(Icons.search_rounded),
        suffixIcon: controller.text.isEmpty
            ? null
            : IconButton(
                tooltip: 'Clear search',
                onPressed: controller.clear,
                icon: const Icon(Icons.close_rounded),
              ),
        labelText: 'Search inbox',
        helperText: 'Cari sender, subject, alias, preview, atau OTP',
      ),
    );
  }
}

class _LockedInboxPanel extends StatelessWidget {
  const _LockedInboxPanel({required this.onSaveCredentials, required this.onOpenDashboard});

  final VoidCallback onSaveCredentials;
  final VoidCallback onOpenDashboard;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.warning.withValues(alpha: .08),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.warning.withValues(alpha: .24)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              const Icon(Icons.lock_rounded, color: AppColors.warning),
              const SizedBox(width: 10),
              Expanded(child: Text('Native inbox terkunci', style: AppText.h2.copyWith(fontSize: 16))),
            ],
          ),
          const SizedBox(height: 8),
          const Text('Simpan Cloudflare credential terenkripsi di device untuk membaca D1 langsung dari app. Kamu tetap bisa buka web dashboard sebagai fallback.', style: AppText.body),
          const SizedBox(height: 12),
          Row(
            children: <Widget>[
              Expanded(child: FilledButton.icon(onPressed: onSaveCredentials, icon: const Icon(Icons.lock_rounded), label: const Text('Save secure'))),
              const SizedBox(width: 10),
              Expanded(child: OutlinedButton.icon(onPressed: onOpenDashboard, icon: const Icon(Icons.open_in_browser_rounded), label: const Text('Web'))),
            ],
          ),
        ],
      ),
    );
  }
}

class _InboxEmailCard extends StatelessWidget {
  const _InboxEmailCard({required this.message, required this.onTap});

  final InboxMessage message;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final subject = message.subject.trim().isEmpty ? '(no subject)' : message.subject.trim();
    final preview = message.previewText.trim().isEmpty ? 'No preview available' : message.previewText.trim();
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Material(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(14),
          child: Container(
            padding: const EdgeInsets.all(13),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: message.isOtp ? AppColors.success.withValues(alpha: .28) : AppColors.border),
              boxShadow: AppShadows.card,
            ),
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
                          Expanded(child: Text(_senderName(message.sender), maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.body.copyWith(fontWeight: FontWeight.w900, color: AppColors.textPrimary))),
                          const SizedBox(width: 8),
                          Text(_formatInboxTime(message.receivedAt), style: AppText.caption),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text(subject, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.body.copyWith(fontWeight: FontWeight.w700, color: AppColors.textPrimary)),
                      const SizedBox(height: 4),
                      Text(preview, maxLines: 2, overflow: TextOverflow.ellipsis, style: AppText.caption),
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 6,
                        runSpacing: 6,
                        children: <Widget>[
                          _InboxChip(text: message.aliasFull, color: AppColors.blue),
                          if (message.isOtp) _InboxChip(text: message.otpCode == '-' ? 'OTP' : 'OTP ${message.otpCode}', color: AppColors.success),
                        ],
                      ),
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

  @override
  Widget build(BuildContext context) {
    final color = isOtp ? AppColors.success : AppColors.primary;
    return Container(
      width: 42,
      height: 42,
      decoration: BoxDecoration(
        color: color.withValues(alpha: .14),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: color.withValues(alpha: .26)),
      ),
      child: Center(child: Text(_senderInitial(sender), style: AppText.body.copyWith(fontWeight: FontWeight.w900, color: isOtp ? AppColors.success : AppColors.primaryVariant))),
    );
  }
}

class _InboxDetailSheet extends StatelessWidget {
  const _InboxDetailSheet({required this.message, required this.onCopyText, required this.onDelete});

  final InboxMessage message;
  final ValueChanged<String> onCopyText;
  final Future<void> Function() onDelete;

  @override
  Widget build(BuildContext context) {
    final body = message.renderedHtml.isNotEmpty ? _stripHtml(message.renderedHtml) : message.previewText;
    return DraggableScrollableSheet(
      initialChildSize: .78,
      minChildSize: .45,
      maxChildSize: .95,
      builder: (context, controller) {
        return Container(
          decoration: const BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
          ),
          child: ListView(
            controller: controller,
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 22),
            children: <Widget>[
              Center(
                child: Container(width: 42, height: 5, decoration: BoxDecoration(color: AppColors.border, borderRadius: BorderRadius.circular(999))),
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
                        Text(_senderName(message.sender), maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.h2),
                        Text(_formatInboxTime(message.receivedAt), style: AppText.caption),
                      ],
                    ),
                  ),
                  IconButton(onPressed: () => Navigator.of(context).pop(), icon: const Icon(Icons.close_rounded)),
                ],
              ),
              const SizedBox(height: 18),
              Text(message.subject.trim().isEmpty ? '(no subject)' : message.subject.trim(), style: AppText.h1),
              const SizedBox(height: 10),
              _SheetInfoRow(label: 'To', value: message.aliasFull),
              _SheetInfoRow(label: 'From', value: message.sender),
              if (message.isOtp) ...<Widget>[
                const SizedBox(height: 4),
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: AppColors.success.withValues(alpha: .08),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: AppColors.success.withValues(alpha: .22)),
                  ),
                  child: Row(
                    children: <Widget>[
                      const Icon(Icons.password_rounded, color: AppColors.success),
                      const SizedBox(width: 10),
                      Expanded(child: Text(message.otpCode == '-' ? 'OTP detected' : message.otpCode, style: AppText.h2.copyWith(color: AppColors.success))),
                      TextButton.icon(onPressed: message.otpCode == '-' ? null : () => onCopyText(message.otpCode), icon: const Icon(Icons.copy_rounded), label: const Text('Copy')),
                    ],
                  ),
                ),
              ],
              const SizedBox(height: 16),
              Text('Message', style: AppText.h2.copyWith(fontSize: 16)),
              const SizedBox(height: 8),
              SelectableText(body.isEmpty ? '(no preview)' : body, style: AppText.body),
              const SizedBox(height: 18),
              Row(
                children: <Widget>[
                  Expanded(child: OutlinedButton.icon(onPressed: () => onCopyText(message.aliasFull), icon: const Icon(Icons.alternate_email_rounded), label: const Text('Copy To'))),
                  const SizedBox(width: 10),
                  Expanded(child: FilledButton.icon(style: FilledButton.styleFrom(backgroundColor: AppColors.error), onPressed: onDelete, icon: const Icon(Icons.delete_outline_rounded), label: const Text('Delete'))),
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
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(label, style: AppText.caption.copyWith(fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          SelectableText(value, style: AppText.body.copyWith(fontWeight: FontWeight.w700, color: AppColors.textPrimary)),
        ],
      ),
    );
  }
}

class _InboxSkeletonList extends StatelessWidget {
  const _InboxSkeletonList();

  @override
  Widget build(BuildContext context) {
    return const Column(children: <Widget>[_SkeletonEmailCard(), _SkeletonEmailCard(), _SkeletonEmailCard()]);
  }
}

class _SkeletonEmailCard extends StatelessWidget {
  const _SkeletonEmailCard();

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(color: AppColors.background, borderRadius: BorderRadius.circular(14), border: Border.all(color: AppColors.border)),
      child: Row(
        children: <Widget>[
          Container(width: 42, height: 42, decoration: BoxDecoration(color: AppColors.border, borderRadius: BorderRadius.circular(14))),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Container(width: double.infinity, height: 12, decoration: BoxDecoration(color: AppColors.border, borderRadius: BorderRadius.circular(999))),
                const SizedBox(height: 8),
                Container(width: 180, height: 10, decoration: BoxDecoration(color: AppColors.border, borderRadius: BorderRadius.circular(999))),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _InboxEmptyState extends StatelessWidget {
  const _InboxEmptyState({this.text = 'Belum ada email di inbox native.', required this.onRefresh});

  final String text;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 22),
      decoration: BoxDecoration(color: AppColors.background, borderRadius: BorderRadius.circular(14), border: Border.all(color: AppColors.border)),
      child: Column(
        children: <Widget>[
          const Icon(Icons.mark_email_unread_outlined, color: AppColors.pending, size: 38),
          const SizedBox(height: 10),
          Text(text, textAlign: TextAlign.center, style: AppText.body.copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(height: 6),
          const Text('Kirim email test ke alias kamu lalu refresh.', textAlign: TextAlign.center, style: AppText.caption),
          const SizedBox(height: 12),
          OutlinedButton.icon(onPressed: onRefresh, icon: const Icon(Icons.refresh_rounded), label: const Text('Refresh')),
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
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: AppColors.error.withValues(alpha: .06), borderRadius: BorderRadius.circular(14), border: Border.all(color: AppColors.error.withValues(alpha: .18))),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(children: <Widget>[const Icon(Icons.error_outline_rounded, color: AppColors.error), const SizedBox(width: 10), Expanded(child: Text('Inbox error', style: AppText.h2.copyWith(fontSize: 16)))]),
          const SizedBox(height: 8),
          Text(message, style: AppText.body),
          const SizedBox(height: 12),
          OutlinedButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh_rounded), label: const Text('Retry')),
        ],
      ),
    );
  }
}

class _InboxChip extends StatelessWidget {
  const _InboxChip({required this.text, required this.color});

  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(color: color.withValues(alpha: .12), borderRadius: BorderRadius.circular(999)),
      child: Text(text, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.caption.copyWith(color: color, fontWeight: FontWeight.w900)),
    );
  }
}

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
  if (text.contains('D1') || text.contains('database')) return 'Inbox D1 belum siap atau credential Cloudflare tidak punya akses.';
  if (text.contains('401') || text.contains('403') || text.contains('unauthorized')) return 'Credential Cloudflare ditolak. Simpan ulang Global API Key.';
  if (text.length > 150) return '${text.substring(0, 150)}…';
  return text;
}
