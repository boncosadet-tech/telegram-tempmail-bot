# Android Build and Signing

## Debug APK

GitHub Actions workflow:

```text
.github/workflows/builddebug.yaml
```

Triggers:

- push to `master` when `apps/mobile/**` or the debug workflow changes
- pull request to `master` touching mobile files
- manual `workflow_dispatch`

Output artifact:

```text
telegram-tempmail-debug-apk/app-debug.apk
```

The debug workflow runs:

1. `flutter pub get`
2. `flutter analyze`
3. `flutter test`
4. `flutter build apk --debug`

## Release APK

GitHub Actions workflow:

```text
.github/workflows/buildrelease.yaml
```

Triggers:

- tag push matching `mobile-v*`
- manual `workflow_dispatch`

Required repository secrets:

```text
ANDROID_KEYSTORE_BASE64
ANDROID_KEYSTORE_PASSWORD
ANDROID_KEY_ALIAS
ANDROID_KEY_PASSWORD
```

Repository variables:

```text
ANDROID_PACKAGE_NAME=id.shizukudes.telegram_tempmail
ANDROID_VERSION_NAME=0.1.8
ANDROID_VERSION_CODE=8
```

The release workflow runs:

1. validate signing secrets
2. restore `android/app/upload-keystore.jks`
3. write `android/key.properties`
4. `flutter pub get`
5. `flutter analyze`
6. `flutter test`
7. `flutter build apk --release`
8. calculate APK SHA256
9. auto-create/update GitHub Release for `mobile-v*` tags
10. upload `app-release.apk` as a release asset
11. upload `telegram-tempmail-release-apk/app-release.apk` as a workflow artifact

## Current release channel

Latest mobile alpha release is published automatically from `mobile-v*` tags. Current release channel:

```text
mobile-v0.1.8-alpha.1
```

APK asset name:

```text
app-release.apk
```

## Generate signing secret locally

Do not commit the keystore.

```bash
keytool -genkeypair \
  -v \
  -keystore upload-keystore.jks \
  -storetype JKS \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -alias telegram-tempmail-upload

base64 -w 0 upload-keystore.jks
```

Set the base64 output as `ANDROID_KEYSTORE_BASE64`.

## Safety checks

- `apps/mobile/android/key.properties` is ignored.
- `apps/mobile/android/app/*.jks` and `*.keystore` are ignored.
- Release signing secrets must stay in GitHub repository secrets only.
- Release workflow needs `contents: write` permission to create/update GitHub Releases.
- APK release notes include SHA256; verify downloaded APK against that digest.
