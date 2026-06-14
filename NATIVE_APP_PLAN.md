# KRMAS Roster — Distribution Options

## The free path (recommended)

### PWA — Add to Home Screen (FREE, both platforms)
The app is already a PWA. On any phone:
- **iPhone:** Open the URL in Safari → tap Share → "Add to Home Screen"
- **Android:** Open in Chrome → tap the install banner or ⋮ → "Add to Home Screen"

Result: full-screen app with the KRMAS icon, works offline, receives notifications. Indistinguishable from a native app to end users. No app store needed, no fees, no review process, instant updates.

This is the recommended approach for an instructor team tool.

### Android APK — direct install (FREE, Android only)
If you want a "real" installable file for Android (without Google Play):
1. Use **PWABuilder** (pwabuilder.com) → enter your live URL → download the Android APK
2. Send the APK to instructors via email, Google Drive, or a download link on krmas.com.au
3. They tap it to install (may need to allow "Install from unknown sources" once)

No developer account needed. Free.

### Android — Google Play Store ($25 USD one-time)
If you want it listed in the Play Store:
1. Go to play.google.com/console → create a developer account ($25 one-time)
2. Use PWABuilder or Capacitor to generate an AAB (Android App Bundle)
3. Upload to Play Console → submit for review (~1-3 days)

### iOS — App Store ($99 USD/year)
Apple requires the developer fee. No free option exists. The PWA approach above is the free iOS solution and works well on Safari.

## Local testing

Run this from the folder containing all the app files:
```
python3 serve.py
```
Then open http://localhost:8080 in your browser. Everything works including Supabase sync (your credentials are already in index.html). Service worker caching won't work on localhost HTTP, but all features function.

To test on your phone while running locally:
1. Find your computer's local IP (e.g. `ifconfig` or `ipconfig` → look for 192.168.x.x)
2. Open `http://192.168.x.x:8080` on your phone (same WiFi network)

## Cost summary

| Option | iOS | Android | Annual |
|---|---|---|---|
| PWA (Add to Home Screen) | ✓ Free | ✓ Free | $0 |
| Direct APK | — | ✓ Free | $0 |
| Google Play Store | — | ✓ | $25 once |
| Apple App Store | ✓ | — | $99/year |
