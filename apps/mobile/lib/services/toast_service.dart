import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';

import '../core/theme/app_design.dart';

class ToastService {
  const ToastService();

  Future<void> show(
    String message, {
    Toast length = Toast.LENGTH_SHORT,
    ToastGravity gravity = ToastGravity.BOTTOM,
  }) async {
    await Fluttertoast.showToast(
      msg: message,
      toastLength: length,
      gravity: gravity,
      backgroundColor: AppColors.textPrimary,
      textColor: AppColors.onPrimary,
      fontSize: 14,
    );
  }

  Future<void> copied([String label = '']) async {
    final msg = label.isEmpty ? 'Copied!' : '$label copied!';
    await show(msg);
  }

  Future<void> otpDetected(String otp) async {
    await show('OTP detected: $otp', length: Toast.LENGTH_LONG);
  }

  Future<void> success(String message) async {
    await Fluttertoast.showToast(
      msg: message,
      toastLength: Toast.LENGTH_SHORT,
      gravity: ToastGravity.BOTTOM,
      backgroundColor: AppColors.success,
      textColor: Colors.white,
      fontSize: 14,
    );
  }

  Future<void> error(String message) async {
    await Fluttertoast.showToast(
      msg: message,
      toastLength: Toast.LENGTH_LONG,
      gravity: ToastGravity.BOTTOM,
      backgroundColor: AppColors.error,
      textColor: Colors.white,
      fontSize: 14,
    );
  }
}
