# DARK CHAT — ARM64 packaging

## Android app (arm64-v8a) — needs Android SDK

On a machine with **Android Studio** (or SDK + JDK 17):

```bash
npm install
npm i -D @capacitor/core@6 @capacitor/cli@6 @capacitor/android@6 --legacy-peer-deps
npx cap add android
# Optional: set production API in capacitor.config.json → "server": { "url": "https://your-host" }
npx cap sync android
npm run build:arm64
# or: npx cap open android  → Build APK
```

Gradle is configured to prefer **arm64-v8a** only (smaller APK, modern phones).

## Server on ARM64 — no Android SDK

```bash
docker buildx build --platform linux/arm64 -f Dockerfile.arm64 -t dark-chat:arm64 --load .
docker run --rm -p 3000:3000 --env-file .env dark-chat:arm64
```

## This CI / sandbox note

Full APK compile needs several GB of SDK + memory. Use Android Studio or GitHub Actions with `android-actions/setup-android` for the APK step.
