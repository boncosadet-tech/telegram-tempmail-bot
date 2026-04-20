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
    final mutedColor = dark ? AppColors.darkTextSecondary : AppColors.textSecondary;
    final borderColor = dark ? AppColors.darkBorder : AppColors.border;
    final surface = dark ? AppColors.darkSurface : AppColors.surface;

    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: dark ? AppColors.darkBackground : AppColors.background,
      fontFamily: 'Inter',
      textTheme: ThemeData(brightness: dark ? Brightness.dark : Brightness.light).textTheme.apply(
            bodyColor: textColor,
            displayColor: textColor,
            decorationColor: textColor,
          ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: surface,
        labelStyle: TextStyle(color: mutedColor, fontSize: 13, fontWeight: FontWeight.w600),
        helperStyle: TextStyle(color: mutedColor, fontSize: 12),
        errorStyle: const TextStyle(color: AppColors.error, fontSize: 12, fontWeight: FontWeight.w600),
        prefixIconColor: mutedColor,
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppSpacing.buttonRadius),
          borderSide: const BorderSide(color: AppColors.primary, width: 2),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppSpacing.buttonRadius),
          borderSide: BorderSide(color: borderColor),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppSpacing.buttonRadius),
          borderSide: const BorderSide(color: AppColors.error),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppSpacing.buttonRadius),
          borderSide: const BorderSide(color: AppColors.error, width: 2),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(48),
          backgroundColor: AppColors.primary,
          foregroundColor: AppColors.onPrimary,
          disabledBackgroundColor: AppColors.pending,
          disabledForegroundColor: AppColors.onPrimary,
          textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppSpacing.buttonRadius)),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size.fromHeight(48),
          foregroundColor: dark ? AppColors.darkText : AppColors.textPrimary,
          side: BorderSide(color: borderColor),
          textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppSpacing.buttonRadius)),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: AppColors.primaryVariant,
          textStyle: const TextStyle(fontWeight: FontWeight.w800),
        ),
      ),
      cardTheme: CardThemeData(
        color: surface,
        elevation: 0,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppSpacing.radius)),
      ),
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith((states) => states.contains(WidgetState.selected) ? AppColors.primary : AppColors.pending),
        trackColor: WidgetStateProperty.resolveWith((states) => states.contains(WidgetState.selected) ? AppColors.primary.withValues(alpha: .28) : AppColors.pending.withValues(alpha: .22)),
      ),
      dividerColor: borderColor,
      snackBarTheme: SnackBarThemeData(
        backgroundColor: dark ? AppColors.darkSurface : AppColors.textPrimary,
        contentTextStyle: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.w600),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    );
  }
}
