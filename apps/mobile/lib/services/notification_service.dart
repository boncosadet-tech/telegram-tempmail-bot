import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

class NotificationService {
  NotificationService._();

  static final NotificationService instance = NotificationService._();

  final FlutterLocalNotificationsPlugin _plugin =
      FlutterLocalNotificationsPlugin();
  bool _initialized = false;
  int _notificationId = 0;

  /// OTP notification channel with custom sound.
  static const String _otpChannelId = 'otp_channel';
  static const String _otpChannelName = 'OTP Notifications';
  static const String _otpChannelDesc = 'Notifications for incoming OTP codes';

  /// Email notification channel.
  static const String _emailChannelId = 'email_channel';
  static const String _emailChannelName = 'Email Notifications';
  static const String _emailChannelDesc = 'Notifications for new emails';

  Future<void> initialize() async {
    if (_initialized) return;

    const androidSettings =
        AndroidInitializationSettings('@drawable/ic_launcher');

    const settings = InitializationSettings(android: androidSettings);

    await _plugin.initialize(settings: settings);
    _initialized = true;

    // Request notification permission on Android 13+.
    if (Platform.isAndroid) {
      await _plugin
          .resolvePlatformSpecificImplementation<
              AndroidFlutterLocalNotificationsPlugin>()
          ?.requestNotificationsPermission();
    }
  }

  /// Show OTP detected notification with custom sound.
  Future<void> showOtpNotification({
    required String code,
    required String sender,
  }) async {
    if (!_initialized) await initialize();

    final androidDetails = AndroidNotificationDetails(
      _otpChannelId,
      _otpChannelName,
      channelDescription: _otpChannelDesc,
      importance: Importance.high,
      priority: Priority.high,
      playSound: true,
      sound: const RawResourceAndroidNotificationSound('otp_notification'),
      enableVibration: true,
      vibrationPattern: Int64List.fromList(<int>[0, 200, 100, 200]),
      ticker: 'OTP: $code',
      category: AndroidNotificationCategory.message,
      visibility: NotificationVisibility.public,
      autoCancel: true,
    );

    await _plugin.show(
      id: _notificationId++,
      title: 'OTP Code: $code',
      body: 'From: $sender — auto-copied to clipboard',
      notificationDetails: NotificationDetails(android: androidDetails),
    );
  }

  /// Show new email notification with sound.
  Future<void> showEmailNotification({
    required String sender,
    required String subject,
    int count = 1,
  }) async {
    if (!_initialized) await initialize();

    const androidDetails = AndroidNotificationDetails(
      _emailChannelId,
      _emailChannelName,
      channelDescription: _emailChannelDesc,
      importance: Importance.defaultImportance,
      priority: Priority.defaultPriority,
      playSound: true,
      sound: RawResourceAndroidNotificationSound('email_notification'),
      enableVibration: true,
      category: AndroidNotificationCategory.email,
      autoCancel: true,
    );

    final title = count > 1 ? '$count new emails' : 'New email from $sender';
    final body = count > 1 ? 'Latest: $subject' : subject;

    await _plugin.show(
      id: _notificationId++,
      title: title,
      body: body,
      notificationDetails: const NotificationDetails(android: androidDetails),
    );
  }

  /// Cancel all notifications.
  Future<void> cancelAll() async {
    await _plugin.cancelAll();
  }
}
