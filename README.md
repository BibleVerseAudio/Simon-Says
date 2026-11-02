This is a new [**React Native**](https://reactnative.dev) project, bootstrapped using [`@react-native-community/cli`](https://github.com/react-native-community/cli).

# Simon Says — Meta Muse Hackathon

**Theme: Push the Frontier** — SAM 3.1 bounding-box geometry as a game engine. No pose model, no keypoints — the box itself is the controller (see §SAM signature engine).

## Meta models used (Stage One evidence)

- **Muse Image** — all artwork: `assets/simona*.png`, `easy.png`, `hard.png`, action images.
- **SAM 3.1** (`sam-3.1` via Meta Model API `POST https://api.meta.ai/v1/responses`) — map-first framing lock, burst sign detection, and move/freeze verdicts: `src/sam/verifier.ts` + `src/sam/signatures.ts`. ~2 frames per command (`"person"` concept prompt, ≤320px JPEG). No key → UNVERIFIED pause. Set key in Settings tab.
- **Muse Spark** (`muse-spark-1.3`, advisory-only, `src/intelligence/museSpark.ts`) — live coach: stage nudge (±1, next-boundary only, one-shot) + persistent trick posture (±0.1 via single `effTrickRate()` on timer/advance/retry/next draws) + encouraging tip every 4th verdict (kids: local templates, no network) + end-of-run summary (reuses last tip, no 2nd call). Run-guarded replies, live badge (`live 1.3 · <ms>` + timestamp, typed `no key`/`timeout`/`offline`/`parse` fallbacks) on HUD + lose card, 12s timeout, schema-validated JSON. Recalibrate is consequential (lose-card `redo body setup` → calibrating gate). Sends NO images/audio/personal data, only aggregate stats. Never overrides SAM verdicts. Live proof: Settings `Test Spark 1.3 live` runs `sparkSmokeTest()` on-device (model/latency/source). Proven: `__tests__/spark.test.ts` (8: valid/malformed/401/no-key/smoke-gate/abort-timeout/posture-clamp/kids-tips).
- **Muse Voice Transcribe** — VS mode custom challenges (planned: challenger speaks → transcribe → play).
- **VS quick/duel shells are simulated scoring** (bot RNG, hand-typed targets). Real SAM-verified duels route through `GameScreen` scoring next.
- SAM is an **any-movement segmenter, not a pose/action recogniser**: person boxes in, grow/shift verdicts out. No joints, no action labels.
- **Pose library** (`src/sam/poseLibrary.ts`): pre-game enrollment. The player performs each pool pose once (Easy 20 / Hard 40 / Bootcamp 12 / Kids 8). SAM stores a personal template per command (body-relative signature + 6x8 grid + SAM zone marker + expected sign). Gameplay judges each live attempt against the player's stored template (signature 45% + grid 35% + marker 20%, adaptive pass bar 62–80%). Markers are SAM-derived zones/change-regions — NEVER joints. Facial commands share the head zone. Missing poses sit out the run. HUD shows `📚 Pose library ON` + `match NN% vs your stored <command>`.
- Tests: `__tests__/verifier.test.ts` (6 rules tests) + `__tests__/signatures.test.ts` (4 signature tests) + `__tests__/calibration.test.ts` (5 zone/profile tests) + `__tests__/wonder.test.ts` (3 profile/scale/fallback tests) + `__tests__/spark.test.ts` (8 live/source/timeout/posture tests) + `__tests__/poseLibrary.test.ts` (9 marker/invariance/matcher/threshold/persistence/pool tests) — 35/35 green. Stock `App.test.tsx` predates the navigation stack and fails on RN-navigation ESM (`Unexpected token 'export'`) — needs `transformIgnorePatterns` work, out of scope for this pass.
- Stage One QA (device, real key): Settings → save key → `Test Spark 1.3 live` shows `live 1.3 · <ms>` (record for sheet); Easy → finish BODY SETUP → play ≥4 moves → HUD tip shows `live 1.3 · <ms>` + timestamp; lose card shows `✨ Spark: live 1.3 · <ms> · <time>`; `recalibrate=true` shows `redo body setup`; airplane-mode run shows `timeout`/`offline` + canned tip and play never blocks.

## SAM signature engine (the showcase)

One SAM box → 9-dim signature (`cx, cy, area, aspect, top, bottom, left, right, height`) → per-frame sign classification, streak-wins scoring. Live green box + signature tag on the selfie so judges see SAM think in real time.

Sign → commands (extract):

| Sign | Geometry | Satisfies |
|---|---|---|
| RAISE_UP | top drops, height grows | raise hands, touch head/ear/nose, wave, cover eyes/mouth |
| WIDEN | aspect +30% | X sign, thumbs up, point |
| NARROW | aspect −30% | cross arms, fist, clap |
| JUMP_UP | centroid up, area stable | jump |
| CROUCH_DOWN | top drops down (wins over WIDEN) | squat, sit-up, burpee, plank, push-up, toes |
| SPIN | aspect collapses | spin, twist |
| STEP_L/R, LEAN, FWD, BACK | centroid / area shifts | steps, kicks, stomps, one-leg stands |

Flow: map-first (`GET INTO FRAME` per mode framing: upper 18–90% · full 12–60% · full+floor low-centroid) → pose library enrollment (`POSE LIBRARY n/N` — player performs each pool pose, SAM stores a personal template + cyan SAM zone marker per pose, missing poses excluded, skip = default judging) → guided body setup (`BODY SETUP x/y` one SAM mark per step, cyan zone marks, persisted personal profile `simonsays.calibration.v1` scaling thresholds via `thresholdScale`, countdown gated on profile lock, skip = defaults) → 10s countdown (median baseline) → 2-frame bursts at 40%/80% of each command, template match + max-delta scoring with 4-frame centroid-path + grid-profile tiebreak, expected `move`/`freeze`, jerk from centroid trajectory, UNVERIFIED immediate pause, sudden-death YOU LOSE only on proven `FAIL_MOVE`. Homepage key panel (masked `••••last4`, change/clear) shares the SAM key; Spark coach tips (stats-only, fallback-safe) every 4th verdict + end-of-run. SAM markers and zones are honest box-geometry approximations of the silhouette — NOT skeleton joints; left/right comes from touch-side steps with front-camera mirroring.

## Cost control (competition credits)

- ~1 SAM image call per command (~320px JPEG) + 1 per level. At $2.50/1k images, a 30s level (~12 commands) ≈ $0.03.
- Score only increments on SAM ✅ when key is set; SAM hiccup keeps the point.

# Getting Started

> **Note**: Make sure you have completed the [Set Up Your Environment](https://reactnative.dev/docs/set-up-your-environment) guide before proceeding.

## Step 1: Start Metro

First, you will need to run **Metro**, the JavaScript build tool for React Native.

To start the Metro dev server, run the following command from the root of your React Native project:

```sh
# Using npm
npm start

# OR using Yarn
yarn start
```

## Step 2: Build and run your app

With Metro running, open a new terminal window/pane from the root of your React Native project, and use one of the following commands to build and run your Android or iOS app:

### Android

```sh
# Using npm
npm run android

# OR using Yarn
yarn android
```

### iOS

For iOS, remember to install CocoaPods dependencies (this only needs to be run on first clone or after updating native deps).

The first time you create a new project, run the Ruby bundler to install CocoaPods itself:

```sh
bundle install
```

Then, and every time you update your native dependencies, run:

```sh
bundle exec pod install
```

For more information, please visit [CocoaPods Getting Started guide](https://guides.cocoapods.org/using/getting-started.html).

```sh
# Using npm
npm run ios

# OR using Yarn
yarn ios
```

If everything is set up correctly, you should see your new app running in the Android Emulator, iOS Simulator, or your connected device.

This is one way to run your app — you can also build it directly from Android Studio or Xcode.

## Step 3: Modify your app

Now that you have successfully run the app, let's make changes!

Open `App.tsx` in your text editor of choice and make some changes. When you save, your app will automatically update and reflect these changes — this is powered by [Fast Refresh](https://reactnative.dev/docs/fast-refresh).

When you want to forcefully reload, for example to reset the state of your app, you can perform a full reload:

- **Android**: Press the <kbd>R</kbd> key twice or select **"Reload"** from the **Dev Menu**, accessed via <kbd>Ctrl</kbd> + <kbd>M</kbd> (Windows/Linux) or <kbd>Cmd ⌘</kbd> + <kbd>M</kbd> (macOS).
- **iOS**: Press <kbd>R</kbd> in iOS Simulator.

## Congratulations! :tada:

You've successfully run and modified your React Native App. :partying_face:

### Now what?

- If you want to add this new React Native code to an existing application, check out the [Integration guide](https://reactnative.dev/docs/integration-with-existing-apps).
- If you're curious to learn more about React Native, check out the [docs](https://reactnative.dev/docs/getting-started).

# Troubleshooting

If you're having issues getting the above steps to work, see the [Troubleshooting](https://reactnative.dev/docs/troubleshooting) page.

# Learn More

To learn more about React Native, take a look at the following resources:

- [React Native Website](https://reactnative.dev) - learn more about React Native.
- [Getting Started](https://reactnative.dev/docs/environment-setup) - an **overview** of React Native and how setup your environment.
- [Learn the Basics](https://reactnative.dev/docs/getting-started) - a **guided tour** of the React Native **basics**.
- [Blog](https://reactnative.dev/blog) - read the latest official React Native **Blog** posts.
- [`@facebook/react-native`](https://github.com/facebook/react-native) - the Open Source; GitHub **repository** for React Native.
