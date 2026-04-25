/// Extracts OTP codes from email subject or body text using regex patterns.
class OtpDetector {
  const OtpDetector();

  static final List<RegExp> _patterns = <RegExp>[
    // "Your code is 123456", "verification code: 123456"
    RegExp(r'(?:code|kode|otp|pin|token)\s*(?:is|:|-|=)\s*(\d{4,8})',
        caseSensitive: false),
    // "123456 is your verification code"
    RegExp(r'(\d{4,8})\s+(?:is your|adalah|merupakan)\s+(?:code|kode|otp)',
        caseSensitive: false),
    // "Use 123456 to verify"
    RegExp(r'(?:use|gunakan|masukkan|enter)\s+(\d{4,8})\s+(?:to|untuk|as)',
        caseSensitive: false),
    // "OTP: 123456" or "OTP 123456"
    RegExp(r'OTP\s*[:\-=]?\s*(\d{4,8})', caseSensitive: false),
    // Standalone 4-8 digit code surrounded by whitespace/punctuation
    RegExp(r'(?:^|[\s\-:=])(\d{4,8})(?:[\s\.\,]|$)'),
  ];

  /// Attempts to extract an OTP code from the given [text].
  /// Returns the first matched code, or `null` if none found.
  String? extract(String text) {
    if (text.trim().isEmpty) return null;
    for (final pattern in _patterns) {
      final match = pattern.firstMatch(text);
      if (match != null && match.group(1) != null) {
        return match.group(1)!;
      }
    }
    return null;
  }

  /// Tries to extract OTP from subject first, then body.
  String? extractFromEmail({required String subject, required String body}) {
    return extract(subject) ?? extract(body);
  }
}
