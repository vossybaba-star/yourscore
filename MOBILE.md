# Mobile Wrap — Capacitor

The native iOS and Android apps are Capacitor shells around the production web app at https://yourscore.app. The web app stays the source of truth — the shell just hosts the WebView, adds native push notifications, and handles OAuth deep links.

Branch: `mobile-wrap`. Web app deploys from `main` and is not affected by anything in this branch.

---

## Architecture

```
┌─────────────────────────────────────┐
│        iOS / Android shell          │
│   (Capacitor native projects)       │
│                                     │
│   ┌─────────────────────────────┐   │
│   │   WebView                   │   │
│   │   ↓                         │   │
│   │   https://yourscore.app     │   │  ← Vercel-hosted Next.js
│   └─────────────────────────────┘   │
│                                     │
│   + @capacitor/app (deep links)     │
│   + @capacitor/browser (OAuth)      │
│   + @capacitor/push-notifications   │
└─────────────────────────────────────┘
```

## Bundle / package identifiers

- iOS bundle ID: `app.yourscore.app`
- Android application ID: `app.yourscore.app`
- Custom URL scheme (OAuth callback): `yourscore://`

## OAuth flow on native

OAuth providers (Google, Apple, Facebook) reject WebView user agents. The native app opens the auth URL in the system browser instead.

1. User taps "Sign in with Google" in the WebView
2. App code calls `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: authCallbackUrl() } })`
   - `authCallbackUrl()` from `src/lib/native.ts` returns `yourscore://auth/callback` on native, `https://yourscore.app/auth/callback` on web
3. On native, intercept the redirect via `@capacitor/browser` and open in Safari/Chrome Custom Tab
4. After Google + Supabase exchange, Supabase redirects to `yourscore://auth/callback?code=...`
5. iOS/Android receives the deep link, foregrounds the app
6. `@capacitor/app` `appUrlOpen` listener catches the URL, extracts the code, calls `supabase.auth.exchangeCodeForSession(code)`
7. Session lands in storage, WebView refreshes

Code-level integration is **not yet wired** — that happens when we can test against the iOS simulator. Helper is staged at `src/lib/native.ts`.

## Supabase dashboard — redirect URLs to add

In **Authentication → URL Configuration → Redirect URLs**, add these alongside existing entries (do NOT remove existing web URLs):

```
yourscore://auth/callback
yourscore://**
```

Keep existing web entries:
```
https://yourscore.app/**
https://yourscore.app/auth/callback
http://localhost:3000/**       (dev)
```

## Apple Developer Program

Required for App Store submission. Enroll at https://developer.apple.com/programs/ — $99/year. Individual enrollment is usually 1–2 days; allow a week+ in case Apple needs extra verification.

## Toolchain

- **Xcode** (full app, not just Command Line Tools) — from Mac App Store
- **CocoaPods** — `brew install cocoapods`
- **Android Studio** — for emulator + Play Store signing (recommended)
- **Apple Developer account** — for iOS provisioning
- **Google Play Console** — $25 one-time fee

## Commands

```bash
# After web changes deploy to Vercel, no native rebuild needed.
# Native shells just point at the live URL.

# After config or native code changes:
npx cap sync                # copies config + plugins to native projects
npx cap open ios            # opens Xcode
npx cap open android        # opens Android Studio
npx cap run ios             # build + run on simulator
npx cap run android         # build + run on emulator
```

## Push notifications

Required for App Store Guideline 4.2 mitigation and the core "alert me when a question fires" loop.

**Scaffold in place:**

- `src/lib/push.ts` — client helper, no-op on web. Call `registerForPush(supabase, userId)` after sign-in.
- `supabase/migrations/01_device_tokens.sql` — `device_tokens` table (paste into SQL editor once).
- `supabase/functions/send-push/index.ts` — Edge Function skeleton. APNs and FCM senders are stubbed; fill in once we have credentials.

**Pending work (needs external accounts):**

1. **Apple Developer account approved** → generate APNs Auth Key (.p8) at developer.apple.com → Keys.
2. **Firebase project for Android** → create project at firebase.google.com → Project settings → Cloud Messaging → grab server key → download `google-services.json` and drop it in `android/app/`.
3. **Set Edge Function secrets:**
   ```bash
   supabase secrets set APNS_KEY_ID=... APNS_TEAM_ID=... APNS_BUNDLE_ID=app.yourscore.app
   supabase secrets set APNS_PRIVATE_KEY="$(cat AuthKey_XXXX.p8)"
   supabase secrets set FCM_SERVER_KEY=...
   ```
4. **Implement APNs + FCM sender bodies** (`sendAPNs` / `sendFCM` in the Edge Function).
5. **Wire trigger:** call the Edge Function from `/admin/rooms` when an admin fires a question.
6. **Wire client registration:** call `registerForPush()` from the auth provider after sign-in.

## App Store 4.2 mitigation

Apple Guideline 4.2 rejects "thin webview wrappers." Mitigations baked in:

- Native push notifications (live question alerts when backgrounded)
- Custom URL scheme deep linking
- Native splash screen + branded icon
- (Planned) Haptic feedback during answer taps

If rejected, response template: emphasize the offline-first push experience, native social sharing, and platform-specific UX that differentiate from the PWA.
