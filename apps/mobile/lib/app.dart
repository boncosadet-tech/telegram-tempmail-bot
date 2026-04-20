import 'package:flutter/material.dart';

import 'features/home/mobile_home_page.dart';

class TempMailMobileApp extends StatelessWidget {
  const TempMailMobileApp({super.key});

  @override
  Widget build(BuildContext context) {
    const ink = Color(0xFF171717);
    const yellow = Color(0xFFFFC928);
    const cream = Color(0xFFFFFBEA);
    const orange = Color(0xFFFF8A00);

    final lightScheme = const ColorScheme(
      brightness: Brightness.light,
      primary: ink,
      onPrimary: yellow,
      secondary: orange,
      onSecondary: ink,
      error: Color(0xFFB00020),
      onError: Colors.white,
      surface: Color(0xFFFFFEF7),
      onSurface: ink,
    );

    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Private TempMail',
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: lightScheme,
        scaffoldBackgroundColor: const Color(0xFFFFF7D1),
        fontFamily: 'Roboto',
        textTheme: ThemeData.light().textTheme.apply(
              bodyColor: ink,
              displayColor: ink,
              decorationColor: ink,
            ),
        inputDecorationTheme: InputDecorationTheme(
          labelStyle: const TextStyle(color: Color(0xFF4A3A00), fontWeight: FontWeight.w700),
          hintStyle: const TextStyle(color: Color(0xFF6B5F3F)),
          prefixIconColor: ink,
          filled: true,
          fillColor: cream,
          focusedBorder: OutlineInputBorder(
            borderSide: const BorderSide(color: ink, width: 2.4),
            borderRadius: BorderRadius.circular(18),
          ),
          enabledBorder: OutlineInputBorder(
            borderSide: const BorderSide(color: Color(0xFF342A00), width: 1.4),
            borderRadius: BorderRadius.circular(18),
          ),
        ),
        filledButtonTheme: FilledButtonThemeData(
          style: FilledButton.styleFrom(
            backgroundColor: ink,
            foregroundColor: yellow,
            disabledBackgroundColor: const Color(0xFF8A8170),
            disabledForegroundColor: Colors.white,
            textStyle: const TextStyle(fontWeight: FontWeight.w900),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          ),
        ),
        outlinedButtonTheme: OutlinedButtonThemeData(
          style: OutlinedButton.styleFrom(
            foregroundColor: ink,
            side: const BorderSide(color: ink, width: 1.8),
            textStyle: const TextStyle(fontWeight: FontWeight.w900),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          ),
        ),
        textButtonTheme: TextButtonThemeData(
          style: TextButton.styleFrom(
            foregroundColor: ink,
            textStyle: const TextStyle(fontWeight: FontWeight.w900),
          ),
        ),
        switchTheme: SwitchThemeData(
          thumbColor: WidgetStateProperty.resolveWith((states) => states.contains(WidgetState.selected) ? ink : const Color(0xFF6B5F3F)),
          trackColor: WidgetStateProperty.resolveWith((states) => states.contains(WidgetState.selected) ? yellow : const Color(0xFFFFE8A3)),
        ),
        snackBarTheme: const SnackBarThemeData(
          backgroundColor: ink,
          contentTextStyle: TextStyle(color: yellow, fontWeight: FontWeight.w800),
        ),
      ),
      darkTheme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: yellow,
          brightness: Brightness.dark,
        ),
      ),
      home: const MobileHomePage(),
    );
  }
}
