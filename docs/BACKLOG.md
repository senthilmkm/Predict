# Predict App — Product Backlog & Future Enhancements

## 📌 Feature: Link Apple ID for Cross-Device Cloud Backup & Recovery

### 🎯 Purpose & Business Goal
Provide an optional, zero-friction account binding feature via **Sign in with Apple** in Settings. This allows users who change iPhones, lose their device, or use multiple devices to seamlessly back up and restore their Kalshi API credentials, risk settings, and trade history in GCP Secret Manager and Firestore DB.

---

### 🎨 User Experience (UX) & Design

#### 1. Zero Onboarding Friction (Default State)
- **First Launch**: First-time users experience zero onboarding friction. They do **not** encounter any mandatory login screens.
- **Default Device Key**: The app generates a hardware-backed, persistent ID (`usr_...`) stored in iOS SecureStore (Hardware Keychain), allowing immediate use.

#### 2. Optional Settings Card ("Link Apple ID")
- Located under **Settings → Account & Cloud Identity**.
- **Card UI**:
  ```
  ┌───────────────────────────────────────────────────────────┐
  │  ☁️ Cloud Backup & Recovery                               │
  │  Link your Apple ID to restore your Kalshi keys and       │
  │  settings if you switch to a new iPhone.                  │
  │                                                           │
  │  ┌─────────────────────────────────────────────────────┐  │
  │  │    Sign in with Apple                              │  │ ← Native Apple Button
  │  └─────────────────────────────────────────────────────┘  │
  └───────────────────────────────────────────────────────────┘
  ```

#### 3. Linked Confirmation UI State
- Once linked via Face ID / Touch ID, the card updates to:
  ```
  ┌───────────────────────────────────────────────────────────┐
  │  ✓ Linked with Apple ID                                   │
  │  Account ID: 001948_a5b6c7d8...                           │
  │  Cloud Backup: Active (GCP Secret Manager & Firestore DB)  │
  └───────────────────────────────────────────────────────────┘
  ```

---

### 🏗️ Technical Architecture & GCP Cloud Integration

#### 1. Identity Resolution Layer (`src/services/userId.ts`)
- **Storage Key**: `foresight.persistent_user_id.v1` in iOS SecureStore.
- **Method**: `setAppleUserId(appleUserId)` replaces `usr_...` with the user's permanent Apple Subject ID (e.g. `001948_a5b6c7d8...`).

#### 2. GCP Secret Manager Naming Schema
- **Secret Path**: `projects/predict-trading-0904/secrets/predict-user-{AppleUserID}-kalshi-key`
- **Payload**: Versioned JSON `{ keyId, privateKeyPem }`.

#### 3. GCP Firestore DB Multi-Tenant Schema
- **User Document**: `projects/predict-trading-0904/databases/(default)/documents/users/{AppleUserID}`
- **Subcollections**:
  - `/users/{AppleUserID}/trades/{tradeId}`
  - `/users/{AppleUserID}/audit/{logId}`

---

### 🛠️ Implementation Plan (EAS Update Compatible)

1. **Import Native Component**:
   - `import * as AppleAuthentication from 'expo-apple-authentication';` (Package `expo-apple-authentication ~57.0.1` is already in `package.json`).
2. **Add Settings Card**:
   - Render `AppleAuthentication.AppleAuthenticationButton` inside `SettingsScreen.tsx`.
3. **Handle Sign-In Callback**:
   ```typescript
   const credential = await AppleAuthentication.signInAsync({
     requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME],
   });
   await setAppleUserId(credential.user);
   await cloudClient.uploadCredentials({ keyId, privateKeyPem });
   ```
4. **Deploy via OTA EAS Update**:
   - Run `npm run eas:update:production` (`--platform ios`).
   - No new native dependencies required; 100% compatible with EAS OTA Updates.
