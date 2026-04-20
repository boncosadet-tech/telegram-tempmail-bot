import 'package:flutter/material.dart';

class AppColors {
  AppColors._();

  static const primary = Color(0xFFF59E0B);
  static const primaryVariant = Color(0xFFD97706);
  static const background = Color(0xFFFAFAFA);
  static const surface = Color(0xFFFFFFFF);
  static const error = Color(0xFFEF4444);
  static const success = Color(0xFF22C55E);
  static const warning = Color(0xFFF59E0B);
  static const pending = Color(0xFF9CA3AF);
  static const textPrimary = Color(0xFF111827);
  static const textSecondary = Color(0xFF6B7280);
  static const body = Color(0xFF374151);
  static const onPrimary = Color(0xFFFFFFFF);
  static const border = Color(0xFFE5E7EB);
  static const blue = Color(0xFF3B82F6);

  static const darkBackground = Color(0xFF111827);
  static const darkSurface = Color(0xFF1F2937);
  static const darkBorder = Color(0xFF374151);
  static const darkText = Color(0xFFF9FAFB);
  static const darkTextSecondary = Color(0xFFD1D5DB);
}

class AppSpacing {
  AppSpacing._();

  static const screen = 20.0;
  static const card = 16.0;
  static const section = 14.0;
  static const radius = 14.0;
  static const buttonRadius = 10.0;
  static const maxWidth = 520.0;
}

class AppShadows {
  AppShadows._();

  static const card = <BoxShadow>[
    BoxShadow(
      color: Color(0x0F000000),
      blurRadius: 8,
      offset: Offset(0, 2),
    ),
  ];
}

class AppText {
  AppText._();

  static const h1 = TextStyle(
    fontSize: 24,
    fontWeight: FontWeight.w800,
    color: AppColors.textPrimary,
    height: 1.15,
  );

  static const h2 = TextStyle(
    fontSize: 18,
    fontWeight: FontWeight.w700,
    color: AppColors.textPrimary,
    height: 1.25,
  );

  static const body = TextStyle(
    fontSize: 15,
    fontWeight: FontWeight.w400,
    color: AppColors.body,
    height: 1.45,
  );

  static const caption = TextStyle(
    fontSize: 13,
    fontWeight: FontWeight.w400,
    color: AppColors.textSecondary,
    height: 1.35,
  );

  static const mono = TextStyle(
    fontFamily: 'monospace',
    fontSize: 13,
    color: AppColors.body,
    height: 1.35,
  );
}

Color statusColor(Object statusName) {
  final value = statusName.toString().split('.').last;
  return switch (value) {
    'ok' => AppColors.success,
    'failed' => AppColors.error,
    'running' => AppColors.blue,
    _ => AppColors.pending,
  };
}
