# Android Build and Signing

## Debug APK

GitHub Actions workflow:

```text
.github/workflows/builddebug.yaml
```

Manual run: GitHub Actions > Build Android Debug APK > Run workflow.

Output artifact:

```text
telegram-tempmail-debug-apk/app-debug.apk
```

## Release APK

GitHub Actions workflow:

```text
.github/workflows/buildrelease.yaml
```

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
ANDROID_VERSION_NAME=0.1.0
ANDROID_VERSION_CODE=1
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

## Current repo setup

The repository is prepared to read signing data from GitHub secrets and write `apps/mobile/android/key.properties` during the release workflow.
