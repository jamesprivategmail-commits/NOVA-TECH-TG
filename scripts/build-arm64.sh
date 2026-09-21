#!/usr/bin/env bash
# Build DARK CHAT for ARM64 (Android arm64-v8a APK when SDK present)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Capacitor sync (web → android/)"
if ! npx cap --version >/dev/null 2>&1; then
  echo "Install first: npm i -D @capacitor/core@6 @capacitor/cli@6 @capacitor/android@6 --legacy-peer-deps"
  exit 1
fi

if [[ ! -d android ]]; then
  echo "==> Adding Android platform"
  npx cap add android
fi

npx cap sync android

APP_GRADLE="android/app/build.gradle"
if [[ -f "$APP_GRADLE" ]] && ! grep -q "abiFilters" "$APP_GRADLE"; then
  echo "==> Restricting ABIs to arm64-v8a"
  # Insert abiFilters after defaultConfig { if not present
  python3 - <<'PY'
from pathlib import Path
p = Path("android/app/build.gradle")
t = p.read_text()
if "abiFilters" in t:
    print("abiFilters already set")
elif "defaultConfig {" in t:
    t = t.replace(
        "defaultConfig {",
        "defaultConfig {\n        ndk {\n            abiFilters 'arm64-v8a'\n        }",
        1,
    )
    p.write_text(t)
    print("abiFilters injected")
else:
    print("Could not find defaultConfig — set abiFilters manually")
PY
fi

if [[ -x android/gradlew ]]; then
  echo "==> Building debug APK (needs Android SDK + JDK)"
  (cd android && ./gradlew assembleDebug) || {
    echo "Gradle failed. Open Android Studio: npx cap open android"
    exit 1
  }
  echo "APKs:"
  find android/app/build/outputs/apk -name '*.apk' 2>/dev/null || true
else
  echo "No gradlew yet. After SDK install: npx cap open android  → Build → APK"
fi
echo "==> Done"
