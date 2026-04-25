import 'package:flutter/material.dart';

/// ProtonMail / Gmail-inspired color palette.
/// Bold purple primary, clean surfaces, vivid accents.
class AppColors {
  AppColors._();

  // Primary — ProtonMail-style deep purple
  static const primary = Color(0xFF6D4AFF);
  static const primaryVariant = Color(0xFF5B3DE0);
  static const accent = Color(0xFFF59E0B);
  static const accentVariant = Color(0xFFD97706);

  // Surfaces
  static const background = Color(0xFFF5F5FA);
  static const surface = Color(0xFFFFFFFF);
  static const surfaceVariant = Color(0xFFF0EEFA);
  static const hover = Color(0xFFEDEDF5);

  // Semantic
  static const error = Color(0xFFDC3545);
  static const success = Color(0xFF1EA885);
  static const warning = Color(0xFFF59E0B);
  static const info = Color(0xFF3B82F6);
  static const pending = Color(0xFFADB5BD);

  // Text
  static const textPrimary = Color(0xFF1B1D1F);
  static const textSecondary = Color(0xFF6B7280);
  static const body = Color(0xFF1B1D1F);
  static const onPrimary = Color(0xFFFFFFFF);
  static const onAccent = Color(0xFFFFFFFF);

  // Borders
  static const border = Color(0xFFE5E7EB);
  static const borderStrong = Color(0xFFD1D5DB);
  static const blue = Color(0xFF3B82F6);

  // Dark mode
  static const darkBackground = Color(0xFF16141F);
  static const darkSurface = Color(0xFF1E1B2E);
  static const darkSurfaceVariant = Color(0xFF2A2640);
  static const darkHover = Color(0xFF332F4D);
  static const darkBorder = Color(0xFF3D3856);
  static const darkText = Color(0xFFECEAF4);
  static const darkTextSecondary = Color(0xFF9B97B0);
}

class AppSpacing {
  AppSpacing._();

  static const screen = 16.0;
  static const card = 16.0;
  static const section = 14.0;
  static const radius = 12.0;
  static const buttonRadius = 24.0;
  static const maxWidth = 520.0;
}

class AppShadows {
  AppShadows._();

  static const card = <BoxShadow>[
    BoxShadow(
      color: Color(0x0A000000),
      blurRadius: 8,
      offset: Offset(0, 2),
    ),
    BoxShadow(
      color: Color(0x05000000),
      blurRadius: 2,
      offset: Offset(0, 1),
    ),
  ];

  static const elevated = <BoxShadow>[
    BoxShadow(
      color: Color(0x14000000),
      blurRadius: 16,
      offset: Offset(0, 4),
    ),
    BoxShadow(
      color: Color(0x08000000),
      blurRadius: 4,
      offset: Offset(0, 1),
    ),
  ];
}

class AppText {
  AppText._();

  static const h1 = TextStyle(
    fontSize: 24,
    fontWeight: FontWeight.w700,
    color: AppColors.textPrimary,
    height: 1.3,
    letterSpacing: -0.3,
  );

  static const h2 = TextStyle(
    fontSize: 17,
    fontWeight: FontWeight.w600,
    color: AppColors.textPrimary,
    height: 1.35,
  );

  static const h3 = TextStyle(
    fontSize: 15,
    fontWeight: FontWeight.w600,
    color: AppColors.textPrimary,
    height: 1.4,
  );

  static const body = TextStyle(
    fontSize: 14,
    fontWeight: FontWeight.w400,
    color: AppColors.body,
    height: 1.5,
  );

  static const caption = TextStyle(
    fontSize: 12,
    fontWeight: FontWeight.w400,
    color: AppColors.textSecondary,
    height: 1.4,
  );

  static const mono = TextStyle(
    fontFamily: 'monospace',
    fontSize: 13,
    color: AppColors.body,
    height: 1.4,
  );

  static const label = TextStyle(
    fontSize: 11,
    fontWeight: FontWeight.w600,
    color: AppColors.textSecondary,
    height: 1.3,
    letterSpacing: 0.8,
  );
}

Color statusColor(Object statusName) {
  final value = statusName.toString().split('.').last;
  return switch (value) {
    'ok' => AppColors.success,
    'failed' => AppColors.error,
    'running' => AppColors.primary,
    _ => AppColors.pending,
  };
}
