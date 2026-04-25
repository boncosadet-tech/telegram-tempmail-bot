import 'package:flutter/material.dart';

import 'core/theme/app_design.dart';
import 'features/home/mobile_home_page.dart';

class TempMailMobileApp extends StatelessWidget {
  const TempMailMobileApp({super.key});

  @override
  Widget build(BuildContext context) {
    final lightScheme = ColorScheme.fromSeed(
      seedColor: AppColors.primary,
      brightness: Brightness.light,
      primary: AppColors.primary,
      onPrimary: AppColors.onPrimary,
      surface: AppColors.surface,
      onSurface: AppColors.textPrimary,
      error: AppColors.error,
    );

    final darkScheme = ColorScheme.fromSeed(
      seedColor: AppColors.primary,
      brightness: Brightness.dark,
      primary: AppColors.primary,
      onPrimary: AppColors.onPrimary,
      surface: AppColors.darkSurface,
      onSurface: AppColors.darkText,
      error: AppColors.error,
    );

    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Private TempMail',
      theme: _theme(lightScheme, false),
      darkTheme: _theme(darkScheme, true),
      home: const MobileHomePage(),
    );
  }

  ThemeData _theme(ColorScheme scheme, bool dark) {
    final textColor = dark ? AppColors.darkText : AppColors.textPrimary;
    final mutedColor =
        dark ? AppColors.darkTextSecondary : AppColors.textSecondary;
    final borderColor = dark ? AppColors.darkBorder : AppColors.border;
    final surface = dark ? AppColors.darkSurface : AppColors.surface;
    final bg = dark ? AppColors.darkBackground : AppColors.background;
    final fillColor =
        dark ? AppColors.darkSurfaceVariant : AppColors.surfaceVariant;

    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: bg,
      textTheme:
          ThemeData(brightness: dark ? Brightness.dark : Brightness.light)
              .textTheme
              .apply(
                bodyColor: textColor,
                displayColor: textColor,
                decorationColor: textColor,
              ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: fillColor,
        labelStyle: TextStyle(
            color: mutedColor, fontSize: 13, fontWeight: FontWeight.w500),
        helperStyle: TextStyle(color: mutedColor, fontSize: 12),
        errorStyle: const TextStyle(
            color: AppColors.error, fontSize: 12, fontWeight: FontWeight.w500),
        prefixIconColor: mutedColor,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppSpacing.radius),
          borderSide: const BorderSide(color: AppColors.primary, width: 1.5),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppSpacing.radius),
          borderSide: BorderSide(color: borderColor),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppSpacing.radius),
          borderSide: const BorderSide(color: AppColors.error),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppSpacing.radius),
          borderSide: const BorderSide(color: AppColors.error, width: 1.5),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(44),
          backgroundColor: AppColors.primary,
          foregroundColor: AppColors.onPrimary,
          disabledBackgroundColor: AppColors.pending,
          disabledForegroundColor: AppColors.onPrimary,
          textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
          shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(AppSpacing.buttonRadius)),
          elevation: 0,
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size.fromHeight(44),
          foregroundColor: AppColors.primary,
          side: BorderSide(
              color: dark ? AppColors.darkBorder : AppColors.borderStrong),
          textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
          shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(AppSpacing.buttonRadius)),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: AppColors.primary,
          textStyle: const TextStyle(fontWeight: FontWeight.w600),
        ),
      ),
      cardTheme: CardThemeData(
        color: surface,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppSpacing.radius),
          side: BorderSide(color: borderColor),
        ),
      ),
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith((states) =>
            states.contains(WidgetState.selected)
                ? AppColors.onPrimary
                : AppColors.pending),
        trackColor: WidgetStateProperty.resolveWith((states) =>
            states.contains(WidgetState.selected)
                ? AppColors.primary
                : AppColors.pending.withValues(alpha: .22)),
      ),
      dividerColor: borderColor,
      popupMenuTheme: PopupMenuThemeData(
        color: surface,
        elevation: 4,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppSpacing.radius),
        ),
        textStyle: AppText.body.copyWith(color: textColor),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor:
            dark ? AppColors.darkSurfaceVariant : AppColors.textPrimary,
        contentTextStyle: AppText.body
            .copyWith(color: dark ? AppColors.darkText : AppColors.onPrimary),
        shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppSpacing.radius)),
        behavior: SnackBarBehavior.floating,
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        titleTextStyle: AppText.h2.copyWith(color: textColor),
        contentTextStyle: AppText.body.copyWith(color: textColor),
      ),
      floatingActionButtonTheme: const FloatingActionButtonThemeData(
        backgroundColor: AppColors.primary,
        foregroundColor: AppColors.onPrimary,
        elevation: 4,
        shape: CircleBorder(),
      ),
    );
  }
}
