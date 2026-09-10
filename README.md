# Predict (local)

Prediction trades, with a buffer. Expo / React Native app for Kalshi 15m markets.

## Commands

```bash
npm test                 # unit + UI (screens, interactions, navigation)
npm run test:unit
npm run test:ui
npm run seed:predict-tab # load Kalshi keys from Command Center .env + cushions/risk
npm run e2e:dry-run      # lean + alerts tick (no orders); add --live-smoke for tiny IOC
npm run verify:kalshi
npm start
```

**Kalshi keys:** paste API key ID + PEM in Settings, or `npm run seed:predict-tab` (reads `RobinhoodTradingMCP/.env`).

**Expo Go:** this project uses **SDK 57** (matches current iOS Expo Go). Poll interval defaults to **15s** (minimum **10s**), set in Settings.

## EAS Build (iOS)

1. `npx expo login` (or use Expo Go account **senthil930**)
2. `npm run eas:init` — links a real EAS `projectId` into `app.json`
3. Apple Developer account required for device builds
4. First iOS build:
   - Internal TestFlight-style / ad-hoc: `npm run eas:ios:preview`
   - Dev client (custom native runtime): `npm run eas:ios:dev`
   - App Store: `npm run eas:ios:prod`

Keep the app open while auto-trading. iOS will not poll every few seconds in background.

**Modes:** Alerts (default), Auto-trade (Face ID — Cloud places on a schedule), and Home Buy / Sell taps (Cloud places now). Kill Switch is the red panic icon in the header.

## Safety

- Auto-trade default: off
- Enabling auto-trade requires credentials + Face ID
- Header panic Kill Switch disarms Auto-trade and hides Home Buy / Sell
- Admin flag Last signals Buy / Sell Off disables all Home taps
- Keep the app open while polling (iOS won’t poll every few seconds in background)
