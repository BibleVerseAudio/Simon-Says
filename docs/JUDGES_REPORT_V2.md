# Simona Says — (https://github.com/BibleVerseAudio/Simona-Says)

## 1. Purpose

This document describes the Simona Says project.
It explains the game, the SAM outline control, the pose library, and the marker mechanics.
It explains the configuration and the construction methods.
The main purpose of the game is an exercise app done either sitting down via easy mode, or standing up via hard mode and boot-camp mode.
This app is for those who want to train with fun.

## 2. The Project in Brief

Simona Says is a mobile game.
The player listens to audio commands.
The player stands in front of the phone camera.
The player does body actions.
The game checks the body actions.
The game gives a result.

The game has five modes.
Easy mode uses a female voice and upper-body commands.
Hard mode uses a male voice and full-body commands.
VS mode is an online challenge.
Bootcamp mode uses floor and cardio commands.
Kids mode uses slow, friendly commands and no trick commands.

The game also calculates calories.
The game saves stars.
The game shows a progress graph over seven days.

## 3. The Core Idea

The team does not use a pose model.
The team does not use skeleton joints.
The team uses the SAM 3.1 segmentation box as the game controller.
The box gives position and size.
The game measures change in position and size.
The game decides if the change is correct.

SAM is an any-movement segmenter.
SAM is not an action recogniser.
SAM gives a person box for each frame.
The game converts the box to movement evidence.
The game does not ask SAM for action names.

## 4. System Build

The game uses React Native 0.81 with the React Native CLI.
The programming language is TypeScript.
The camera library is react-native-vision-camera 4.7.3.
The audio library is react-native-sound.
The storage library is AsyncStorage.
The test tool is Jest.
The device is Android.
The telephone is the test target.

The camera uses the front lens.
The camera shows a selfie view.
Easy mode and Kids mode zoom to 1.4 times.
Hard mode and Bootcamp mode zoom to 0.6 times.
The game does not use frame processors.
The game now requests the camera permission when the game screen opens.
The game shows an allow button if the permission is blocked.
The game does not show a dark, silent camera view.

## 5. The SAM Outline Control

### 5.1 How SAM Works in This Game

The game sends a snapshot to the Meta Model API.
The API model is sam-3.1.
The request uses the Responses API over HTTPS POST.
The input is the text "person" and a JPEG image.
The image is small.
The maximum side is 320 pixels.
The quality is 70 percent.
The API returns boxes in a text format.
The game parses the boxes.
Each box has x1, y1, x2, y2, width, height, and confidence.

The key is stored on the device.
The key is not sent to the judges.
The key is not shown in full in the application.
The Settings screen saves the key.
The Settings screen shows only the last four characters.
The home screen shows a masked key panel.
The home screen button now says "Enter Meta Model API Key" when no key is saved.

### 5.2 The Baseline

The game makes a baseline before play.
The baseline is the resting box of the player.
The game takes many samples.
The game uses the median of the samples.
The game accepts the median only if two or more samples agree.
One frame alone does not make a baseline.
A moving frame does not become the baseline.

### 5.3 The Verdicts

The game uses three verdicts.
The verdicts are in src/sam/verifier.ts.

- PASS: the movement matches the command.
- FAIL_MOVE: the movement is wrong.
- UNVERIFIED: the camera or the network did not give evidence.

The player moved on a trap command gives FAIL_MOVE.
The player did not move on a Simon command gives FAIL_MOVE.
UNVERIFIED pauses the game.
UNVERIFIED does not give a loss.

### 5.4 How the Game Judges Movement

The judge measures two values.
The first value is grow.
Grow is the change in box area.
The second value is shift.
Shift is the change in box centre.
Each command class has a threshold.
A big command has a high threshold.
A small command has a low threshold.
Kids mode uses one quarter of the threshold.

The judge also measures jerk.
Jerk is irregular movement in the box path.
The game uses the centroid path from the burst frames.
A jerky movement fails.
A smooth movement passes.
The first FAIL_MOVE ends the adult run.
This is sudden-death.
Kids mode makes three tries.
Kids mode does not give a loss.

### 5.5 The Signature Engine

The team made a signature engine in src/sam/signatures.ts.
One box becomes nine numbers.
The numbers are centre x, centre y, area, aspect, top, bottom, left, right, and height.
The engine compares the numbers before and after the command.
The engine gives a sign.

The signs are STILL, RAISE_UP, CROUCH_DOWN, JUMP_UP, STEP_LEFT, STEP_RIGHT, STEP_FORWARD, STEP_BACKWARD, WIDEN, NARROW, LEAN_LEFT, LEAN_RIGHT, SPIN, and UNKNOWN.

The order of the checks is important.
STILL is first.
RAISE_UP is second.
CROUCH_DOWN is checked before WIDEN because a squat also makes the box wide.
SPIN uses a narrow aspect.
Steps use the centre.
Leans use a small centre change.

Each command maps to one or more signs.
Raise hands maps to RAISE_UP.
Cross arms maps to NARROW.
Jump maps to JUMP_UP.
Squat maps to CROUCH_DOWN.
Spin maps to SPIN.
Steps map to STEP_LEFT and STEP_RIGHT.

The screen shows the box and the sign.
The judges see the SAM outline in real time.
The outline is green.
The sign text is on the outline.

### 5.6 Sampling for Cost Control

The game does not call SAM for every command at high stages.
At stage 4 and above, the game samples one in two commands.
At stage 7 and above, the game samples one in three commands.
The other commands pass on the honor tick.
The log records the sampled commands.
The team states this honestly.

## 6. New Feature — The Pose Library

### 6.1 What the Pose Library Is

The pose library is a pre-game enrollment system.
The code is in src/sam/poseLibrary.ts.
The game screen integration is in src/screens/GameScreen.tsx.
The command pools are in src/sam/commandPools.ts.

Before gameplay, the player performs the required poses for the selected mode.
SAM outlines the player for each pose.
The game places a marker on the SAM-derived body zone for that pose.
The game records the pose as a personal reference template.
The game stores the template on the device.
During gameplay, the player repeats the pose.
The game judges the live attempt against the stored template.

The stored pose is the reference from enrollment.
The live pose is the attempt during gameplay.
There are no new pose types during gameplay.
The live poses are repetitions of the enrolled poses.

### 6.2 When Enrollment Runs

Enrollment runs after the framing lock.
Enrollment runs before the 10 second countdown.
The countdown does not start until enrollment is complete or formally waived.
Enrollment runs at the start of each game.
The game runs enrollment for each new run from Home and for each retry.
Player position, clothing, and lighting can change between runs.
Stored templates from a previous run are used only after revalidation.

The command set is the exact command pool for the selected mode.
Easy mode enrolls 20 commands.
Hard mode enrolls 40 commands.
Bootcamp mode enrolls 12 commands.
Kids mode enrolls 8 commands.
The enrollment list comes from poolFor in src/sam/commandPools.ts.
The gameplay draw pool comes from the same function.
The two lists cannot drift.

The order is neutral baseline first.
The poses follow in pool order.
The neutral baseline is repeated last in the design.

### 6.3 Enrollment Flow — Step by Step

For each command, the game shows progress text.
The text pattern is "POSE LIBRARY 3/20".
The text gives the command instruction.
The game plays the existing command audio file for that command.
The game uses the Simon audio version for enrollment.

The player gets time to do the pose.
Adults get 3 seconds to get ready.
Adults get a 2 second hold window.
Kids get 2 seconds to get ready.
Kids get a shorter hold.

The game takes two SAM snapshots in the hold window.
The snapshots are about 700 milliseconds apart.
The two boxes must agree.
The agreement test is IoU greater than 0.4.
If the boxes disagree, the game tries again.
The maximum is three attempts.
The disagreement reset is also bounded.
After three disagreement resets, the pose is marked missing.
A moving player cannot stall enrollment forever.

On success, the game stores the template.
The game draws the green SAM outline.
The game draws the cyan zone marker.
The game shows "Stored ✅ SAM marked your {zone} zone".
The game waits 600 milliseconds.
The game moves to the next pose.

After three failed attempts, the command is marked missing.
A missing command is excluded from the draw pool for that run.
The summary shows the stored count and the missing count.
Example: "Stored 18/20 — 2 commands sit out this game".

The live outline and marker render during enrollment.
The same overlay family renders during gameplay.

### 6.4 What Is Stored Per Pose

Each template stores the command identifier.
Each template stores the agreed SAM box.
Each template stores a body-relative signature.
Each template stores a 6 by 8 grid.
Each template stores a marker.
Each template stores the expected sign.
Each template stores confidence.
Each template stores the time.

The library stores the mode.
The library stores the version.
The library stores the neutral box.
The library stores the neutral grid.
The library stores the left-right mapping.
The library stores the framing label.
The library stores the adaptive pass threshold.

The AsyncStorage key pattern is simonsays.poseLibrary.v1.<mode>.
One library is stored for each mode.
The game does not store images.
The load function checks version and shape.
Corrupt data gives null.
Corrupt data never throws.
Corrupt data causes re-enrollment.

### 6.5 Body-Relative Normalisation

Absolute frame coordinates are not valid between runs.
The player can stand in a different position.
The player can stand at a different scale.
All comparisons use coordinates relative to the neutral box.

The function toRelative converts a box to neutral-relative values.
Centre x and centre y become offsets from the neutral centre.
Area becomes a ratio to the neutral area.
Aspect becomes a ratio to the neutral aspect.
Top becomes an offset from the neutral top.
Height becomes a ratio to the neutral height.

Grid profiles are body-relative by construction.
The function gridFromBox makes the grid from the box.
The grid is 6 columns by 8 rows.

Marker coordinates are stored relative to the neutral box.
The function projectMarker projects a stored marker onto today's neutral box.
A stored marker follows the player to the new position.
A stored marker follows the player to the new scale.

### 6.6 Revalidation — The Return Player Check

If a stored library exists for the mode, the game does not force a full re-enrollment at once.
The game runs the framing lock.
The game takes the neutral baseline.
The game re-projects the stored markers onto today's neutral box.
The game asks the player to repeat two random stored poses.
The game takes one SAM snapshot for each check pose.
The game calculates matchScore for each check pose.
Both check poses must pass.
The pass test uses the library pass threshold minus 0.05.

If both checks pass, the game accepts the library.
The game shows "Welcome back — pose library still fits ✅".
The game skips the full enrollment.
The game opens the countdown gate.

If one check fails, the game runs the full enrollment.
The game does not argue with the player.
Framing or clothing may have changed.

### 6.7 Skip and Waiver Rules

A Skip button is on the enrollment card.
The button text is "Skip pose library (default judging)".
Skip sets enrollmentWaived to true.
Skip uses the existing judge path.
The existing judge path is judgeMove, signsForCommand, and jerk.
The personal threshold scale comes from the older calibration profile if it exists.
The default scale is 1.

The HUD shows the active judging mode.
The library mode text is "📚 Pose library ON".
The default mode text is "🎯 Default judging".

Kids can skip after three poses minimum.
Kids use cheerful copy.
Kids use a forgiving matcher threshold.

## 7. New Feature — SAM Zone Markers

### 7.1 Honesty Rule — Markers Are Not Joints

SAM does not give skeleton joints.
SAM does not give true elbow coordinates.
SAM does not give true wrist coordinates.
SAM does not give true ear coordinates.
All markers are SAM-derived zone markers.
The team never labels a marker as an anatomical joint.
The code, the tests, the UI, and this report use "zone marker" and "SAM mark".

### 7.2 How a Marker Is Calculated

The primary method is the silhouette-change centroid.
The game compares the neutral grid and the pose grid.
The game finds the cells with the largest change.
The game uses strict top-half weighting.
The marker is the centroid of the change region.
This marks where the silhouette changed for that pose.
A hand-to-ear pose changes top-side cells.
An elbow-hold pose changes mid-side cells.

The fallback method is the zone rectangle centre.
The fallback is used if the change is too small.
The zone rectangles come from zoneRectFor in src/sam/calibration.ts.
The zones are head, headSideA, headSideB, leftShoulder, rightShoulder, leftHand, rightHand, hips, leftKnee, rightKnee, and feet.

Facial commands all share the head zone.
SAM box data cannot separate nose, chin, cheeks, eyes, and mouth.
Facial templates differ only by the personal silhouette-change pattern.
The team states this honestly.

### 7.3 Marker Display

During enrollment, the marker is a cyan dot with a zone label.
The label pattern is "● {zone} zone".
During gameplay, the marker for the current command is projected onto today's body.
Only the current command marker shows.
A stale marker from another command does not show.
This prevents a misleading display.

The stored marker renders as a target for the current command.
The verdict shows the match percent.
The player sees the personalised judging work in real time.

## 8. Gameplay Judging With Templates

### 8.1 Evidence Kept From the Old System

Template judging does not replace the old evidence.
The game keeps burst frames.
The game keeps judgeMove.
The game keeps the sign check.
The game keeps jerk measurement.
The game keeps the video strip.
The game keeps the grid tiebreak.
The game keeps sequence tagging.
The game keeps UNVERIFIED pause rules.
The game keeps sudden-death.

Template matching is added as primary personalised evidence.

### 8.2 The Match Score

The function matchScore is in src/sam/poseLibrary.ts.
The function compares a live box to a stored template.

The signature score uses weighted distance.
Area weight is 0.25.
Aspect weight is 0.20.
Centre x weight is 0.15.
Centre y weight is 0.15.
Top weight is 0.15.
Height weight is 0.10.

The grid score is shapeSimilarity between the live grid and the template grid.

The marker score compares the live change-region centroid to the stored marker.
No change region gives a neutral score of 0.5.

The total is 0.45 signature + 0.45 grid + 0.10 marker.
The total is clamped to 0 to 1.

### 8.3 Decision Rules — Adults

A command with a template uses the adaptive pass bar.
PASS requires total at or above the pass bar.
PASS requires the target template to score higher than the neutral template.
PASS requires no hard fail from sign or judgeMove.

A total between the UNVERIFIED band and the pass bar gives UNVERIFIED.
UNVERIFIED gives a retry.
UNVERIFIED never gives a loss.

A total below 0.55 with proven movement gives FAIL_MOVE.
The reason is wrong pose.

A trap is a bare command with no Simon prefix.
A trap expects freeze.
PASS for a trap requires neutral match at or above 0.75.
PASS for a trap requires target-pose match below 0.60.
Moving into the named pose on a trap gives FAIL_MOVE as before.
An unclear trap gives UNVERIFIED.

A command without a template is not drawn.
If a template-less command is drawn by error, the game uses the existing judge path.

### 8.4 Decision Rules — Kids

Kids use a pass threshold of 0.55.
Kids never get FAIL_MOVE from templates.
The existing three-try rule stands.
The template score selects friendly feedback.
A score of 40 to 55 percent gives "So close! Try a bigger ⭐ move".
Kids now see their match percent in the verdict.
Example: "(86% match)".

### 8.5 HUD Evidence

After each verdict, the game shows the match percent.
The pattern is "match 86% vs your stored {command}".
The HUD pill shows the judging mode.
Library mode shows "📚 Pose library ON".
Default mode shows "🎯 Default judging".

The marker state clears when no template exists.
A stale "match 0%" cannot remain from a prior command.

## 9. Adaptive Personal Threshold

After enrollment, the game calculates the player spread.
The spread is the median template distance from neutral.
The function medianTemplateSpread gives the spread.
The function adaptiveThreshold gives the pass bar.

The formula clamps the bar between 0.62 and 0.80.
The base is 0.72.
Subtle movers get a lower bar.
Dramatic movers get a stricter bar.
The bar is stored in the library.
The summary shows "Your match bar: 68%".

Template judging takes precedence when both systems exist.
The old thresholdScale still scales judgeMove thresholds.
The two systems complement each other.

## 10. How the Team Configured SAM for This Game

### 10.1 Framing

The game gates play on framing.
The player must stand in the correct frame position.
Easy mode needs the face and shoulders big in frame.
The box area must be between 18 percent and 90 percent.
Hard mode needs the full body.
The box area must be between 12 percent and 60 percent.
Bootcamp needs the full body and floor.
The box centre must be low in the frame.

The camera zoom matches the mode.
Easy mode uses 1.4 times zoom.
Hard mode uses 0.6 times zoom.
The player sees a framing message.
The game does not start the countdown before the framing is correct.

### 10.2 Guided Body Setup

The team also has a guided body setup.
The setup is in src/sam/calibration.ts.
The setup has steps.
The player holds each pose.
The system takes one SAM mark per step.

The adult steps are stand still, touch right ear, touch left ear, raise hands, touch head, cross arms, crouch, step right, step left, and stand still.
The kids set is short.
The kids set has five steps.

Each step shows cyan zone marks.
The zones are box-geometry approximations.
The zones are not skeleton joints.
The left and right mapping uses the touch steps.
The front camera mirrors the image.
The setup records if image left is player right.

### 10.3 Personal Profile

The setup makes a personal profile.
The profile is stored on the device.
The profile has the resting box, neutral area, neutral aspect, neutral centre, zone rectangles, and movement deltas.
The deltas are arms-up delta, crouch delta, and step delta.

The profile gives a threshold scale.
The scale is in the function thresholdScale.
A small mover has a small delta.
The game uses a low scale for a small mover.
A big mover has a scale near one.
The scale is between 0.5 and 1.25.
Low confidence limits the scale.
The judge uses the scale in expectationFor.
The game shows the scale on the screen as a percent.

### 10.4 Countdown Gate

The game uses a 10-second countdown.
The countdown starts only after enrollment and profile are ready.
The countdown is not blind.
During the countdown the game takes more samples.
The samples refine the baseline.
The median method is used again.
Play starts when the countdown ends.

The player can skip the setup.
The skip uses default thresholds.
The skip is shown on the screen.
The skip does not give a loss.

### 10.5 Video Strip and Grid Tiebreak

The game takes burst frames during each command.
The burst frames are at 40 percent and 80 percent of the audio time.
The frames are tag-marked by command.
Old frames do not enter the next command.

The game builds a video strip from the burst frames.
The strip is the centroid path.
The game calculates path length and hold score.
The game also makes a grid profile.
The grid is 6 columns by 8 rows.
The game compares grid profiles.
The grid delta is a tiebreak.

A pass with a flat hold on a move command gives UNVERIFIED.
The game does not give a free pass.
The game does not give a loss.

## 11. Safety Rules

The game separates proven faults from service faults.
A network error is UNVERIFIED.
A missing key is UNVERIFIED.
No silhouette is UNVERIFIED.
UNVERIFIED pauses the game.
The player taps resume.
Only FAIL_MOVE ends the run.

The team does not give points on SAM failure.
Kids mode gives three tries.
Kids mode keeps the star on SAM failure.

Async safety is used.
Each run has a run identifier.
Each command has a sequence number.
Burst frames carry the sequence number.
Slow answers after retry are dropped.
The timer is pure.
No state update is inside an updater.

Enrollment audio is released on cancel and on unmount.
A leaked Sound cannot remain after back-out.

## 12. The Game Modes in Detail

### 12.1 Easy Mode

Easy mode uses the female voice.
Easy mode has 20 upper-body commands.
The camera zooms to 1.4 times.
The framing needs the face and shoulders big in frame.

### 12.2 Hard Mode

Hard mode uses the male voice.
Hard mode has 40 commands.
The commands are 20 upper-body and 20 lower-body.
The camera zooms to 0.6 times.
The framing needs the full body.

### 12.3 Bootcamp Mode

Bootcamp mode uses the male voice.
Bootcamp mode has 12 floor and cardio commands.
The commands are lie on back, sit-up, push-up position, push-up, plank, jumping jacks, burpee, mountain climbers, sit and stand, lie and jump, kneel, and stand tall.
The player can pick a round length.
The lengths are 30 seconds to 10 minutes.

### 12.4 Kids Mode

Kids mode uses the female voice.
Kids mode has eight friendly commands.
Kids mode has no trick commands.
Kids mode always uses the Simon prefix.
Kids mode uses three tries.
Kids mode has no YOU LOSE screen.
The speed follows the success rate.
Kids enrollment uses shorter holds.
Kids may skip after three poses.
Kids see the match percent.

### 12.5 VS Mode and Online

VS mode uses a lobby.
The player picks Easy, Hard, or Bootcamp.
The online screen is a 2 by 2 grid.
One cell is the player.
Three cells are bots.
The game is a simulation.
The team states this honestly.
The VS mode uses stars.
The winner gets one star.
The losers lose one star.
The floor is zero.

Friend duels use a six-character code.
The code is shared with the Share function.
The code expires after seven days.

## 13. Stages and Difficulty

The game has ten stages.
The stages set speed, gap, and trick rate.
Stage 1 uses 0.85 times speed.
Stage 10 uses 2.5 times speed.
Stage 10 uses 70 percent tricks in hard mode.
The timer does not end the run.
The timer moves to the next stage.
The run ends only on FAIL_MOVE.

Elite players get a bonus.
The hit rate must be 80 percent or more over eight tries.
The speed increases by streak.
The gap has a floor of 0.35 seconds.
The trick rate is 65 percent for elite players.

Kids mode uses adaptive speed.
The speed moves to a target.
The target is based on hit rate.
The speed is between 0.7 times and 1.5 times.

Commands are drawn without immediate repeats.
The game uses a no-repeat history.
Adults use a history of five.
Kids use a history of three.
Missing enrollment commands are excluded before the draw.

## 14. Fitness and Calories

The game counts calories.
The model uses the MET method.
The weight is 70 kilograms.
Light arm moves use 3.0 MET.
Jump and spin moves use 8.0 MET.
Plank uses 5.0 MET.
The calories count only on proven moves.
The screen shows the calories in the corner.
The screen shows the calories on the lose card.

## 15. The Muse Spark Coach

The game uses Muse Spark 1.3.
The model is muse-spark-1.3.
Spark gives advice only.
Spark does not give verdicts.
Spark does not replace SAM.

The game sends only game statistics.
The game does not send images.
The game does not send audio.
The game does not send personal data.
The statistics are score, hits, tries, streak, stage, speed, and failure reason.

Spark replies with JSON.
The fields are next stage delta, trick rate, feedback, and recalibrate flag.
The game validates the JSON.
The stage delta is minus one, zero, or one.
The stage delta applies only at the timer boundary.
The trick nudge is small.
The nudge is between minus 0.1 and plus 0.1.
One accessor gives the trick rate.
All command draws use the accessor.

The game calls Spark every fourth verdict in adult modes.
Kids mode does not call Spark.
Kids mode uses local template tips.
The end-of-run summary reuses the last tip.
The game does not pay for a second call.

Spark replies are run-guarded.
Slow replies after retry are dropped.
The screen shows the source.
The source is live, no-key, timeout, offline, parse, or local.
The screen shows the latency in milliseconds.
The screen shows the time.

If Spark says recalibrate, the game acts.
The lose card shows a redo body setup button.
The button opens enrollment first.
The signal is not only a hint.

The Settings screen has a Test Spark 1.3 live button.
The button runs a smoke test.
The test shows the model, the latency, the source, and the feedback.
The judges must record the live output before the demo.
Mock tests do not prove the live model.
The team states this honestly.

## 16. Content Production Methods

### 16.1 Audio

The team made the command audio with edge-tts.
The female voice is en-US-AriaNeural.
The male voice is en-US-ChristopherNeural.
The rate is minus 10 percent.
The volume is plus 20 percent.
The pitch is minus 15 Hz.
Each command has a plain file and a Simon file.
The files are in Android raw resources.
The names use the voice prefix.
Example: female_simon_raise_both_hands.mp3.

The command set has 20 upper-body commands.
Hard mode adds 20 lower-body commands.
Bootcamp adds 12 floor commands.
The game uses the files from the device.
The game does not download the files during play.

Enrollment plays the same command audio.
The audio is released on cancel.

### 16.2 Artwork

Muse Image made the artwork.
The files are simona.png, easy.png, and hard.png.
The home screen uses a poster.
The poster says SIMON SAYS at the top.
The poster says PICK YOUR MODE at the bottom.
The image is not cut.

### 16.3 Build and Push Methods

The build is Gradle 8.14.3.
The debug build gives app-debug.apk.
The build uses the debug keystore.
The push uses Android Debug Bridge (adb).
The install uses adb install -r.
Metro serves the debug JavaScript.
The device reverse uses adb reverse tcp:8081 tcp:8081.

The team fixed an invariant error.
The native main component name did not match the JavaScript name.
The name was fixed to SimonaSays.
The team fixed a camera error.
The permission request was missing.
The game now requests the camera permission on open.
The game shows an allow button if the permission is blocked.
Debug builds load JavaScript from Metro by design.
A standalone demo needs a release build or a running Metro server.

## 17. Test Methods and Results

The team uses Jest tests.
The tests do not use the camera.
The tests do not use the network.
The tests use mocks for fetch and storage.

The verifier tests check six rules.
The signature tests check four rules.
The calibration tests check five rules.
The Wonder tests check three rules.
The Spark tests check eight rules.
The pose library tests check nine rules.
The total is 35 tests.
The last full run gives 35 passes.

The pose library tests check marker top region for arms up.
The tests check marker side for step right.
The tests check fallback for identical boxes.
The tests check zone mapping honesty.
The tests check normalisation invariance.
The tests check self-match at or above 0.9.
The tests check neutral versus raise below the threshold.
The tests check neutral trap match.
The tests check threshold clamps.
The tests check pool coverage for all modes.
The tests check enrollment pool equals gameplay pool.
The tests check threshold direction and empty-library default.
The tests check persistence round-trip.
The tests check corrupt data safety.

TypeScript compiles with no errors.
The command is npx tsc --noEmit.
The debug build passes with assembleDebug.
The last build result is BUILD SUCCESSFUL.

## 18. Honesty for the Judges

The SAM zones are not joints.
The SAM boxes are not skeleton data.
The silhouette grid is an approximation.
The grid uses the box and a vertical mass model.
The grid is not a pixel mask.
Facial commands share the head zone.

The online VS mode is a simulation.
The bots use random numbers.
The team does not claim real online SAM duels at this stage.
The duel codes are local.

Muse Spark is advice only.
Spark does not judge moves.
Spark does not give the win.
SAM gives the verdicts.
Template judging adds personalised SAM evidence.
Template judging does not override sudden-death or UNVERIFIED safety.

The debug APK uses Metro.
The release build must be used for a standalone demo.
Live Spark proof needs a real key on a real device.
Live pose enrollment needs a real key on a real device.
Mock tests do not prove live segmentation on selfie framing.

## 19. Privacy

The API key stays on the device.
The key is shown with a mask.
Only the last four characters are visible.
Spark sends only aggregate statistics.
SAM sends only small JPEG images of the player frame.
The game does not store the images.
The game stores the calibration profile on the device.
The game stores the pose library on the device.
The game stores the history on the device.
No image is stored in the pose library.

## 20. Device Test Still Required

Code tests prove logic.
Device tests prove the camera and the live API.
The judges' demo must do these steps on the device.

Step 1: save a real Meta key in Settings.
Step 2: press Test Spark 1.3 live.
Step 3: record the live output with latency.
Step 4: open Easy mode.
Step 5: complete framing.
Step 6: complete pose library enrollment.
Step 7: check the cyan zone marker for each pose.
Step 8: check the Stored confirmation for each pose.
Step 9: complete body setup.
Step 10: finish the countdown.
Step 11: play at least five commands.
Step 12: check "match X% vs your stored …" on the HUD.
Step 13: check the marker for the current command only.
Step 14: test one bare trap command and hold still.
Step 15: close the app, reopen, and check the revalidation quick check.

## 21. Conclusion

The team made a game where the SAM box is the controller.
The new pose library makes the controller personal.
The player first teaches SAM his or her own poses.
SAM marks the change zone for each pose.
SAM stores a body-relative template for each pose.
The game later compares each live attempt to the stored pose.
Framing, calibration, and a personal threshold scale make the box fair for each player.
Signatures, jerk measurement, a video strip, and template matching make the verdict strong.
Fail-safe rules separate service faults from player faults.
Muse Spark is a coach, not a referee.
The methods are in the code and the tests.
The judges can verify the code and the tests.

## Appendix A — Key Files

- src/screens/GameScreen.tsx — the game loop, framing, enrollment, calibration, countdown, verdicts, and HUD.
- src/sam/commandPools.ts — single source of truth for command pools.
- src/sam/poseLibrary.ts — pose templates, zone markers, normalisation, matching, adaptive threshold, persistence.
- src/sam/verifier.ts — SAM client, box parsing, baseline, judge, and jerk.
- src/sam/signatures.ts — nine-number signatures and sign classification.
- src/sam/calibration.ts — setup steps, zone rectangles, personal profile, and threshold scale.
- src/sam/gridProfile.ts — 6 by 8 silhouette grid and similarity.
- src/intelligence/museSpark.ts — Muse Spark 1.3 coach, fallback, and smoke test.
- src/screens/SettingsScreen.tsx — key save and live Spark test.
- src/screens/HomeScreen.tsx — mode selection and masked key panel.
- __tests__/verifier.test.ts — six verifier tests.
- __tests__/signatures.test.ts — four signature tests.
- __tests__/calibration.test.ts — five calibration tests.
- __tests__/wonder.test.ts — three scale and fallback tests.
- __tests__/spark.test.ts — eight Spark tests.
- __tests__/poseLibrary.test.ts — nine pose library tests.
- README.md — short project notes.
- docs/JUDGES_REPORT.md — this report.

## Appendix B — Test Commands

- npx tsc --noEmit — TypeScript has no errors.
- npx jest __tests__/poseLibrary.test.ts __tests__/verifier.test.ts __tests__/signatures.test.ts __tests__/calibration.test.ts __tests__/wonder.test.ts __tests__/spark.test.ts — 35 tests pass.
- android/gradlew -p android assembleDebug — BUILD SUCCESSFUL.
- adb install -r android/app/build/outputs/apk/debug/app-debug.apk — Success, only when the user approves the push.
