# HANDOFF FOR MUSE SPARK — Pose Library + Marker Mechanics (implement exactly)

You are implementing a new pre-game mechanic for Simona Says (React Native 0.81, TypeScript, SAM 3.1 via Meta Model API). Do not redesign unrelated systems. Do not claim skeleton joints. Follow every rule below.

## 0. Core concept — read first

BEFORE gameplay starts in every game, the player performs the required poses for the selected mode. SAM outlines the player for each pose. The game places a marker on the SAM-derived body zone for that pose, records (stores) the pose as a personal reference template, and later — during gameplay — judges each live attempt against the stored template for the commanded pose. Terminology: "stored pose" = reference recorded in pre-game enrollment. "Live pose" = the player's attempt during gameplay. There are no new pose *types* during gameplay; live poses are repetitions of enrolled poses.

## 1. Honesty constraint (non-negotiable)

SAM 3.1 returns person boxes/masks — NOT skeleton joints (no true elbow, wrist, ear coordinates). Therefore every marker is a SAM-DERIVED ZONE MARKER, computed as follows, in this priority order:

1. PRIMARY: marker = centroid of the silhouette-change region = grid cells with the largest change between the neutral (standing still) grid profile and the pose grid profile (use `gridFromBox` / `profileDelta` in `src/sam/gridProfile.ts`, 6x8 grid). This is genuinely SAM-derived: it marks WHERE the player's silhouette changed for that pose (e.g. hand-to-ear changes top-side cells; elbow-hold changes mid-side cells).
2. FALLBACK (if change region is degenerate, e.g. total change < 0.02): marker = centre of the predefined zone rectangle from `zoneRectFor` in `src/sam/calibration.ts` for that command's zone (head, headSideA/B, leftHand, rightHand, leftShoulder, rightShoulder, hips, leftKnee, rightKnee, feet).
3. NEVER label a marker as an anatomical joint in UI, code comments, tests, or docs. Label it "zone marker" / "SAM mark". UI text examples: "SAM marked your ear-touch zone ✅", never "elbow joint detected".

Facial commands (nose/chin/cheeks/eyes/mouth) all map to the head zone; SAM box data cannot distinguish facial features. Their templates differ only by the player's personal silhouette-change pattern. State this in docs.

## 2. When enrollment runs

- Enrollment runs AFTER framing lock (existing `mapping` gate) and BEFORE the 10s countdown. The countdown must NOT start until enrollment is complete or formally waived (see §7).
- Enrollment runs at the start of EACH game (each new run from Home / retry), because player position, clothing, and lighting change. Stored templates from a previous run may be reused ONLY after revalidation (§6).
- The command set to enroll = the EXACT command pool for the selected mode: Easy = 20 upper-body, Hard = 40 (20 upper + 20 lower), Bootcamp = 12 floor/cardio, Kids = 8 friendly. Derive from the existing `poolFor(voice, gameMode)` in `src/screens/GameScreen.tsx`. Do not hard-code a second list.
- Order: neutral baseline first, then poses grouped upper-body → lower-body → floor (pool order is acceptable), neutral baseline repeated last.

## 3. Enrollment flow (per pose) — exact steps

For each command in the pool, in order:

1. Show progress "POSE LIBRARY 3/20", the command instruction in text (e.g. "Touch your RIGHT ear. Hold it."), and play the EXISTING command audio file for that command (`commandFile(voice, id, simon=true)`).
2. Give the player 3 seconds to get into the pose ("Get ready… 3·2·1"), then a 2-second hold window ("Hold it…").
3. During the hold window take TWO SAM snapshots ~700ms apart (reuse `snapSmall()` + `segmentPerson` + `pickBox` from the existing code). Require both boxes to agree (IoU > 0.4); if they disagree or a snapshot fails, retry this pose (max 3 attempts).
4. On success: compute and store the template (§4), draw the SAM outline (existing green box) AND the zone marker (cyan dot + label, e.g. "rightHand zone"), show "Stored ✅", brief 600ms pause, advance to the next pose.
5. On 3 failed attempts: mark the command MISSING. Do not block forever. Missing commands are EXCLUDED from this run's draw pool. Show final summary "Stored 18/20 — 2 commands sit out this game".
6. Live outline + marker must render during enrollment exactly as during gameplay (same overlay components/styles family).

## 4. What is stored per pose (template)

Create a new module `src/sam/poseLibrary.ts`. Store, per command id:

- `commandId: string`
- `box`: the agreed SAM box (median of the two snapshots, component-wise).
- `signature`: the 9-dimension signature from `signatureOf` (`src/sam/signatures.ts`), stored BODY-RELATIVE (see §5).
- `grid`: the 6x8 grid profile cells from `gridFromBox`, body-relative.
- `marker`: `{ x, y, zone }` — normalised 0..1 frame coordinates of the zone-marker centroid, plus the fallback zone name used (or `'delta'` when from change-region).
- `sign`: result of `classifySign(neutralBox, poseBox)` at enrollment (expected sign for this player).
- `confidence`: SAM box confidence if present, else agreement-based (1.0 both agree, lower otherwise).
- `at`: timestamp.

Also store: `mode`, `version: 1`, `neutralBox` (median baseline), `neutralSignature`, `neutralGrid`, `leftIsImageRight` (from the existing touch-right/touch-left calibration logic), `framing` (zoom + frameNeed label used).

Persistence: AsyncStorage key `simonsays.poseLibrary.v1.<mode>` (one library per mode). Save on enrollment completion. Load must validate version and shape; corrupt data = ignore and re-enroll. Never store images.

## 5. Body-relative normalisation (critical)

Absolute frame coordinates are invalid when the player moves between runs. Therefore all comparisons use coordinates RELATIVE to the neutral box:

- Convert any box to neutral-relative signature: divide centre/area/aspect deltas by the neutral box geometry (reuse `signatureOf` on the box, then express cx/cy as offset from neutral cx/cy, area as ratio to neutral area, top/bottom/left/right as offsets from neutral edges).
- Grid profiles are already box-relative by construction (`gridFromBox`); keep as-is.
- Marker coordinates are stored relative to the neutral box (x = (markerX - neutral.x1) / neutralWidth, likewise y), so a stored marker can be re-projected onto today's neutral box at revalidation and during gameplay rendering.

Implement `toRelative(box, neutral)` and `projectMarker(markerRel, neutral)` in `poseLibrary.ts` and unit-test translation/scale invariance: the same pose recorded 100px right and 20% larger must produce near-identical relative templates (tolerance 0.05).

## 6. Revalidation at the start of each game

If a stored library exists for this mode:

1. Run framing lock and neutral baseline as usual.
2. Re-project stored markers/templates onto today's neutral box (§5).
3. Ask the player to repeat THREE poses only: stand still (already have), plus two random enrolled poses (one upper, one lower/floor if present).
4. If both check poses match their templates (matcher §8, adult threshold), accept the library ("Welcome back — pose library still fits ✅") and skip full enrollment.
5. If either check fails, run FULL enrollment (§3). Do not argue with the player; framing/clothing may have changed.

## 7. Skip / waiver rules

- A "Skip setup" button exists (accessibility + demo speed). Skipping sets `enrollmentWaived = true`: no templates, gameplay uses the EXISTING judge path (`judgeMove` + `signsForCommand` + jerk, personal threshold scale = 1 or from the older calibration profile if present).
- The HUD must show which judging mode is active: "📚 Pose library ON" vs "🎯 Default judging (setup skipped)".
- Kids mode: enrollment uses the 8 kids commands, shorter holds (2s ready, 1.5s hold), cheerful copy, and the matcher threshold is forgiving (§8). Kids may skip after 3 poses minimum.

## 8. Gameplay judging with templates (the payoff)

During gameplay, for each command, keep ALL existing evidence (burst frames, `judgeMove`, sign check, jerk, video-strip, grid tiebreak, sequence tagging, UNVERIFIED pause rules, sudden-death). ADD template matching as the primary personalised evidence:

For the best burst frame (and the final frame), compute `matchScore(liveBox, template)` in `poseLibrary.ts`:

- `signatureScore` = 1 − weighted normalised distance between live relative signature and template relative signature (weights: area 0.25, aspect 0.2, cx 0.15, cy 0.15, top 0.15, height 0.1), clamped 0..1.
- `gridScore` = `shapeSimilarity(liveGrid, templateGrid)` (existing function).
- `markerScore` = 1 − distance between live change-region centroid (vs prev verified frame) and the template marker (relative coords), clamped 0..1; if no change region, 0.5 neutral.
- `total = 0.45*signatureScore + 0.35*gridScore + 0.20*markerScore`.

Decision rules (adults):
- Command WITH template: PASS requires `total >= 0.72` AND target template scores higher than the neutral template by >= 0.10 AND existing sign/`judgeMove` does not hard-fail. If `total` is 0.55–0.72 = UNVERIFIED (retry, never a loss). Below 0.55 with proven movement = FAIL_MOVE (wrong pose).
- TRAP (bare command, expected freeze): PASS requires live match to NEUTRAL template >= 0.75 and target-pose match < 0.60. Moving into the named pose on a trap = FAIL_MOVE as today.
- Command WITHOUT template (missing/excluded): it must never be drawn this run (§3.5). If somehow drawn, fall back to the existing judge path.

Kids: PASS threshold 0.55, no FAIL_MOVE ever (existing 3-try rule stands), template score only picks the friendliest feedback ("So close! Try a bigger ⭐ move" when 0.4–0.55).

HUD: after each verdict show "match 86% vs your stored <command>" so judges see personalised template judging working. The stored marker for the current command renders as a hollow cyan target ring during the command; it fills green on PASS, red on FAIL_MOVE.

## 9. Threshold personalisation from the library

After enrollment, compute the player's spread: median pairwise `matchScore` between each pose template and the neutral template. Set the adult PASS threshold adaptively: `clamp(0.72 - (spread - 0.5) * 0.2, 0.62, 0.8)` — subtle movers (low spread) get a lower bar; dramatic movers get a stricter bar. Store the computed threshold in the library and show it in the enrollment summary ("Your match bar: 68%"). This complements (does not replace) the existing `thresholdScale` calibration profile; if both exist, template judging takes precedence and `thresholdScale` still scales `judgeMove` thresholds.

## 10. Files to create / modify

- CREATE `src/sam/poseLibrary.ts` — types, normalisation, marker computation, template store/load/clear, `matchScore`, adaptive threshold. Pure functions where possible.
- MODIFY `src/sam/calibration.ts` — reuse `zoneRectFor`/zones; do not duplicate zone data.
- MODIFY `src/screens/GameScreen.tsx` — new gate phase `enrolling` between `mapping` and `countdown`; enrollment runner (mirrors the existing calibrating runner patterns: runId guards, seq tags, cancelled flags); marker + target-ring overlays; template-aware judging in the existing burst-scoring block; HUD judging-mode + match-percent; skip path; revalidation path.
- CREATE `__tests__/poseLibrary.test.ts` — see §11.
- MODIFY `README.md` and `docs/JUDGES_REPORT.md` — describe pose library + zone markers honestly (markers are SAM-derived zones/change-regions, NOT joints; facial commands share the head zone).

Do NOT: remove the existing judge path, change sudden-death/UNVERIFIED semantics, change Spark behaviour, add frame processors, or claim pose estimation anywhere.

## 11. Required tests (all must pass)

1. Marker computation: neutral vs arms-up boxes → marker lands in top region; neutral vs step-right → marker lands on the correct side; degenerate (identical boxes) → falls back to zone rect centre, zone name recorded.
2. Normalisation invariance: same pose shifted +100px and scaled 1.2x → relative signature within 0.05 of original; projected marker follows the new neutral box.
3. Matcher: identical box vs its template ≥ 0.9; neutral box vs a raise-hands template < target threshold; trap logic (neutral live vs named-pose template) classifies freeze correctly with synthetic boxes.
4. Adaptive threshold: low-spread synthetic library → threshold < 0.72; high-spread → > 0.72; clamped to [0.62, 0.8].
5. Persistence: save → load round-trip equals stored library; corrupt JSON / wrong version → null (re-enroll), never throws.
6. Pool coverage: enrollment step list for easy/hard/bootcamp/kids exactly equals `poolFor` output for that mode (import the pools or replicate via the same source of truth — no drift).
7. Existing suites stay green: verifier (6), signatures (4), calibration (5), wonder (3), spark (8).

## 12. Validation + delivery gates

- `npx tsc --noEmit` — zero errors.
- `npx jest __tests__/verifier.test.ts __tests__/signatures.test.ts __tests__/calibration.test.ts __tests__/wonder.test.ts __tests__/spark.test.ts __tests__/poseLibrary.test.ts` — all green; report the count.
- `android/gradlew -p android assembleDebug` — BUILD SUCCESSFUL.
- Do NOT push via adb until the user says "push". Report: files changed, test counts, build result, and any rule you could not implement with the reason.

## 13. Copy requirements (exact wording patterns)

- Enrollment header: "POSE LIBRARY {n}/{total} — do this pose, SAM will remember it"
- Stored confirmation: "Stored ✅ SAM marked your {zone} zone"
- Summary: "Pose library ready: {stored}/{total} poses · your match bar {pct}%"
- Revalidation pass: "Welcome back — pose library still fits ✅"
- HUD judging mode: "📚 Pose library ON" / "🎯 Default judging (setup skipped)"
- Verdict with template: "match {pct}% vs your stored {command}"
