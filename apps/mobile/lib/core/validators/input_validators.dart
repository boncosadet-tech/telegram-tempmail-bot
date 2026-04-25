class InputValidators {
  static final RegExp _domainPattern = RegExp(
    r'^(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$',
  );

  static final RegExp _scriptPattern =
      RegExp(r'^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$');

  static String normalizeDomain(String value) {
    return value
        .trim()
        .toLowerCase()
        .replaceFirst(RegExp(r'^https?://'), '')
        .split(RegExp(r'[/#?]'))
        .first
        .replaceFirst(RegExp(r'^@+'), '')
        .replaceFirst(RegExp(r'\.+$'), '');
  }

  static bool isDomain(String value) {
    final domain = normalizeDomain(value);
    return _domainPattern.hasMatch(domain);
  }

  static bool isCloudflareEmail(String value) {
    final email = value.trim();
    return RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(email);
  }

  static bool isGlobalApiKey(String value) {
    final key = value.trim();
    return key.length >= 20 && !key.contains(RegExp(r'\s'));
  }

  static bool isTelegramBotToken(String value) {
    return RegExp(r'^\d{6,}:[A-Za-z0-9_-]{30,}$').hasMatch(value.trim());
  }

  static String normalizeScriptName(String value, String domain) {
    final raw = value.trim().isEmpty
        ? 'telegram-tempmail-${normalizeDomain(domain)}'
        : value.trim();
    var script = raw
        .toLowerCase()
        .replaceAll(RegExp(r'[^a-z0-9-]+'), '-')
        .replaceAll(RegExp(r'-+'), '-')
        .replaceAll(RegExp(r'^-+|-+$'), '');
    if (script.length > 63) {
      script = script.substring(0, 63).replaceAll(RegExp(r'-+$'), '');
    }
    return script.isEmpty ? 'telegram-tempmail' : script;
  }

  static bool isScriptName(String value) {
    return _scriptPattern.hasMatch(value.trim());
  }
}
