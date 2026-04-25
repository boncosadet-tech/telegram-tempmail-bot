import 'dart:async';

import 'package:flutter/services.dart';
import 'package:sms_autofill/sms_autofill.dart';

import 'toast_service.dart';

class OtpAutofillService {
  OtpAutofillService({ToastService? toast})
      : _toast = toast ?? const ToastService();

  final SmsAutoFill _smsAutoFill = SmsAutoFill();
  final ToastService _toast;
  StreamSubscription<String>? _subscription;
  bool _listening = false;

  Future<void> startListening({
    void Function(String code)? onOtpReceived,
  }) async {
    if (_listening) return;
    _listening = true;
    try {
      await _smsAutoFill.listenForCode();
      _subscription = SmsAutoFill().code.listen((code) async {
        if (code.isNotEmpty) {
          await Clipboard.setData(ClipboardData(text: code));
          await _toast.otpDetected(code);
          onOtpReceived?.call(code);
        }
      });
    } on PlatformException {
      _listening = false;
    }
  }

  Future<void> stopListening() async {
    _listening = false;
    await _subscription?.cancel();
    _subscription = null;
    SmsAutoFill().unregisterListener();
  }

  Future<String?> getAppSignature() async {
    try {
      return await _smsAutoFill.getAppSignature;
    } on PlatformException {
      return null;
    }
  }

  void dispose() {
    stopListening();
  }
}
