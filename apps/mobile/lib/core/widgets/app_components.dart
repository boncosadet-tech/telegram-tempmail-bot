import 'package:flutter/material.dart';

import '../theme/app_design.dart';

class AppSurfaceCard extends StatelessWidget {
  const AppSurfaceCard({super.key, required this.child, this.accentColor, this.padding = AppSpacing.card, this.marginBottom = AppSpacing.section});

  final Widget child;
  final Color? accentColor;
  final double padding;
  final double marginBottom;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).colorScheme.brightness == Brightness.dark;
    final surface = dark ? AppColors.darkSurface : AppColors.surface;
    final border = dark ? AppColors.darkBorder : AppColors.border;
    return Container(
      margin: EdgeInsets.only(bottom: marginBottom),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: surface,
        borderRadius: BorderRadius.circular(AppSpacing.radius),
        border: Border.all(color: border),
        boxShadow: dark ? const <BoxShadow>[] : AppShadows.card,
      ),
      child: Stack(
        children: <Widget>[
          if (accentColor != null) Positioned(left: 0, top: 0, bottom: 0, width: 4, child: ColoredBox(color: accentColor!)),
          Padding(
            padding: EdgeInsets.fromLTRB(padding + (accentColor == null ? 0 : 4), padding, padding, padding),
            child: child,
          ),
        ],
      ),
    );
  }
}

class AppHeroCard extends StatelessWidget {
  const AppHeroCard({
    super.key,
    required this.icon,
    required this.title,
    required this.subtitle,
    this.trailing,
    this.chips = const <Widget>[],
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final Widget? trailing;
  final List<Widget> chips;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: <Color>[AppColors.primary.withValues(alpha: .22), AppColors.primary.withValues(alpha: .06)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.primary.withValues(alpha: .24)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(color: AppColors.primary, borderRadius: BorderRadius.circular(15)),
                child: Icon(icon, color: AppColors.onPrimary, size: 24),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(title, style: AppText.h2.copyWith(fontSize: 21)),
                    const SizedBox(height: 3),
                    Text(subtitle, style: AppText.caption),
                  ],
                ),
              ),
              if (trailing != null) trailing!,
            ],
          ),
          if (chips.isNotEmpty) ...<Widget>[
            const SizedBox(height: 12),
            Wrap(spacing: 8, runSpacing: 8, children: chips),
          ],
        ],
      ),
    );
  }
}

class AppSectionHeader extends StatelessWidget {
  const AppSectionHeader({super.key, required this.title, required this.subtitle, this.icon});

  final String title;
  final String subtitle;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          if (icon != null) ...<Widget>[
            Icon(icon, color: AppColors.primaryVariant, size: 22),
            const SizedBox(width: 10),
          ],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(title, style: AppText.h2),
                const SizedBox(height: 3),
                Text(subtitle, style: AppText.caption),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class AppStatusChip extends StatelessWidget {
  const AppStatusChip({super.key, required this.text, required this.color, this.icon});

  final String text;
  final Color color;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
      decoration: BoxDecoration(color: color.withValues(alpha: .12), borderRadius: BorderRadius.circular(999)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          if (icon != null) ...<Widget>[Icon(icon, size: 14, color: color), const SizedBox(width: 5)],
          Text(text, style: AppText.caption.copyWith(color: color, fontWeight: FontWeight.w900)),
        ],
      ),
    );
  }
}

class AppActionTile extends StatelessWidget {
  const AppActionTile({super.key, required this.icon, required this.title, required this.subtitle, required this.onTap, this.color = AppColors.primary});

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback? onTap;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: color.withValues(alpha: .08),
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(borderRadius: BorderRadius.circular(14), border: Border.all(color: color.withValues(alpha: .20))),
          child: Row(
            children: <Widget>[
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(color: color.withValues(alpha: .14), borderRadius: BorderRadius.circular(13)),
                child: Icon(icon, color: color),
              ),
              const SizedBox(width: 11),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.body.copyWith(fontWeight: FontWeight.w900, color: AppColors.textPrimary)),
                    const SizedBox(height: 2),
                    Text(subtitle, maxLines: 2, overflow: TextOverflow.ellipsis, style: AppText.caption),
                  ],
                ),
              ),
              Icon(Icons.chevron_right_rounded, color: color),
            ],
          ),
        ),
      ),
    );
  }
}

class AppKeyValueGrid extends StatelessWidget {
  const AppKeyValueGrid({super.key, required this.items});

  final List<AppKeyValueItem> items;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 10,
      runSpacing: 10,
      children: items
          .map(
            (item) => Container(
              width: 140,
              padding: const EdgeInsets.all(11),
              decoration: BoxDecoration(color: AppColors.background, borderRadius: BorderRadius.circular(12), border: Border.all(color: AppColors.border)),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(item.label, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.caption.copyWith(fontWeight: FontWeight.w800)),
                  const SizedBox(height: 5),
                  Text(item.value, maxLines: 2, overflow: TextOverflow.ellipsis, style: AppText.body.copyWith(fontWeight: FontWeight.w900, color: AppColors.textPrimary)),
                ],
              ),
            ),
          )
          .toList(growable: false),
    );
  }
}

class AppKeyValueItem {
  const AppKeyValueItem({required this.label, required this.value});

  final String label;
  final String value;
}
