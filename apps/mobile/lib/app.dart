import 'package:flutter/material.dart';

import 'features/home/mobile_home_page.dart';

class TempMailMobileApp extends StatelessWidget {
  const TempMailMobileApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Private TempMail',
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFFFFC928),
          brightness: Brightness.light,
        ),
        scaffoldBackgroundColor: const Color(0xFFFFF7D1),
        fontFamily: 'Roboto',
      ),
      darkTheme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFFFFC928),
          brightness: Brightness.dark,
        ),
      ),
      home: const MobileHomePage(),
    );
  }
}
