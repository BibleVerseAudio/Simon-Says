import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Camera, useCameraDevice, useCameraPermission, type Camera as CameraType } from 'react-native-vision-camera';
import Sound from 'react-native-sound';
import { judgeMove, loadSamKey, medianBaseline, parseSamBoxes, pickBox, scoreJerk, segmentPerson, shouldPauseOnUnverified, type SamBox, type SamStatus } from '../sam/verifier';
import { classifySign, signatureOf, signsForCommand, type SignMatch } from '../sam/signatures';
import { signBetween } from '../sam/gameDriver';
import { calibrationSteps, loadCalibrationProfile, saveCalibrationProfile, thresholdScale, zoneRectClamped, type CalibrationProfile, type CalibStep } from '../sam/calibration';
import { adviseNextStage, endOfRunSummary } from '../sam/../intelligence/museSpark';
import { centroidPath, holdScore, pathLength } from '../sam/videoTrackReal';
import { gridFromBox, profileDelta } from '../sam/gridProfile';
import { checkLandmarks, checksForCommand, getPosePlugin } from '../sam/poseVerifier';
import { poolFor } from '../sam/commandPools';
import { Vibration } from 'react-native';
import { logSession } from '../online/history';

Sound.setCategory('Playback');

// Command pools live in src/sam/commandPools.ts (single source of truth
// for gameplay draws AND pose-library enrollment — handoff §11.6, no drift).

type Voice = 'female' | 'male';

function commandFile(voice: Voice, id: string, simon: boolean) {
  return `${voice}_${simon ? 'simon_' : ''}${id}.mp3`;
}

// Fitness pitch: calories per verified move, MET-style by effort class.
// 70kg baseline: kcal = MET × 70 × hours. Per-move seconds estimated.
function kcalFor(commandId: string): number {
  let met = 3.0; // light upper-body default
  let secs = 4;
  if (/jump_once|spin_around|do_a_burpee|lie_down_and_jump_up|do_jumping_jacks/.test(commandId)) { met = 8.0; secs = 4; }
  else if (/do_a_squat|march_in_place|kick_|do_a_pushup|do_mountain_climbers/.test(commandId)) { met = 6.0; secs = 5; }
  else if (/hold_a_plank/.test(commandId)) { met = 5.0; secs = 8; }
  else if (/sit_up|get_into_pushup_position|lie_on_your_back|kneel_down|sit_down_and_stand_up/.test(commandId)) { met = 5.0; secs = 5; }
  else if (/step_|lift_your|stomp_|stand_on|bend_your|twist|take_two|touch_your_toes|stand_up_tall/.test(commandId)) { met = 4.5; secs = 4; }
  else if (/raise_both_hands|make_an_x_sign|clap_your_hands/.test(commandId)) { met = 3.5; secs = 3; }
  return (met * 70 * (secs / 3600));
}

// 10 staged levels: speed + gap + tricks per stage. Max stage repeats
// forever when "stay here" is on.
const STAGES = [
  { speed: 0.85, gap: 2.2, trick: 0.0 },
  { speed: 1.0, gap: 1.6, trick: 0.2 },
  { speed: 1.15, gap: 1.4, trick: 0.35 },
  { speed: 1.3, gap: 1.2, trick: 0.5 },
  { speed: 1.45, gap: 1.0, trick: 0.5 },
  { speed: 1.6, gap: 0.85, trick: 0.55 },
  { speed: 1.75, gap: 0.7, trick: 0.6 },
  { speed: 1.9, gap: 0.6, trick: 0.6 },
  { speed: 2.1, gap: 0.5, trick: 0.65 },
  { speed: 2.5, gap: 0.35, trick: 0.7 },
] as const;
const MAX_STAGE = STAGES.length;
function stageFor(level: number) {
  return STAGES[Math.min(Math.max(level, 1), MAX_STAGE) - 1];
}

// Round-length presets (seconds). Bootcamp-as-training: up to 10 min.
const DURATIONS = [30, 60, 90, 120, 180, 300, 600] as const;

function fmtDur(s: number) {
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
}

function boxIoU(a: SamBox, b: SamBox): number {
  const ix1 = Math.max(a.x1, b.x1);
  const iy1 = Math.max(a.y1, b.y1);
  const ix2 = Math.min(a.x2, b.x2);
  const iy2 = Math.min(a.y2, b.y2);
  const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
  const area = (bb: SamBox) => Math.max(0, bb.x2 - bb.x1) * Math.max(0, bb.y2 - bb.y1);
  const union = area(a) + area(b) - inter;
  return union > 0 ? inter / union : 0;
}

function useSoundFile(name: string) {
  // (staged levels: see STAGES above)
  const ref = useRef<Sound | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const s = new Sound(name, Sound.MAIN_BUNDLE, err => {
      if (!err) setLoaded(true);
    });
    ref.current = s;
    return () => { s.release(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);
  return { sound: ref, loaded };
}

// No-repeat shuffle: draws a random command that isn't in recent history.
// historyLen 3 (kids) / 5 (adults) — guarantees variety, still unpredictable.
function drawCommand(pool: readonly string[], recent: string[]): string {
  const avail = pool.filter(c => !recent.includes(c));
  const src = avail.length > 0 ? avail : [...pool];
  return src[Math.floor(Math.random() * src.length)];
}

function PlayModeScreen({ mode, voice, onBack }: { mode: string; voice: Voice; onBack: () => void }) {
  const gameMode = mode.includes('BOOTCAMP') || mode.includes('bootcamp') ? 'bootcamp'
    : mode.includes('KIDS') || mode.includes('kids') ? 'kids'
    : mode.includes('HARD') || mode.includes('hard') ? 'hard' : 'easy';
  const isKids = gameMode === 'kids';
  const pool = poolFor(voice, gameMode);
  // Easy (female) crops to half/upper body; hard (male) zooms out to full body.
  const fullBody = voice === 'male';
  const [count, setCount] = useState(10);
  // SAM baseline progress during the 10s get-ready: hold still while SAM
  // outlines the body (resting silhouette for all move verdicts).
  const [phase, setPhase] = useState<'getready' | 'playing' | 'done'>('getready');
  const [level, setLevel] = useState(1);
  const [score, setScore] = useState(0);
  const [kcal, setKcal] = useState(0);
  const [timeLeft, setTimeLeft] = useState(30);
  // Adjustable round length (bootcamp-as-training: up to 10 min).
  // Picked on the get-ready screen, counts down from there.
  const [duration, setDuration] = useState<number>(30);
  const [commandLabel, setCommandLabel] = useState('Get ready…');
  // playKey re-arms the per-command playback effect after each advance.
  const [playKey, setPlayKey] = useState(0);
  // One Sound instance, reloaded per command. Key forces reload on command change.
  const [over_logged, setOverLogged] = useState(false);
  // Stay-here mode: repeat the current level forever instead of advancing.
  // Toggle on the done card. Kids always effectively stay (adaptive pace).
  const [stayHere, _setStayHere] = useState(false);
  // Stage-clear flash banner on auto-advance (endless run).
  const [stageFlash, setStageFlash] = useState(false);
  useEffect(() => {
    if (!stageFlash) return;
    const t = setTimeout(() => setStageFlash(false), 2200);
    return () => clearTimeout(t);
  }, [stageFlash]);
  // Adaptive difficulty (kids): speed follows success rate.
  // Formula: target = 0.7 + hitRate * 0.8, clamped 0.7x–1.5x, eased toward.
  // Elite (adults, hitRate>=80% over 8+ tries): streak bonuses —
  // speed pushes past the ramp cap (+0.05/streak step to 2.5x), gap shrinks
  // to 0.35s floor, trick rate rises to 65%. Slump (<50%) eases back.
  const [adaptSpeed, setAdaptSpeed] = useState(0.85);
  const [hits, setHits] = useState(0);
  const [tries, setTries] = useState(0);
  const [streak, setStreak] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const pushRecent = (id: string) => setRecent(r => [...r.slice(isKids ? -2 : -4), id]);
  const hitRate = tries === 0 ? 1 : hits / tries;
  const elite = !isKids && tries >= 8 && hitRate >= 0.8;
  const eliteBonus = elite ? Math.min(0.5, streak * 0.05) : 0;
  // Staged speed: lookup by level (kids still adaptive). Elite streaks
  // push past the stage speed to 2.5x cap.
  const stage = stageFor(level);
  const stagedSpeed = Math.min(2.5, stage.speed + eliteBonus);
  const speed = isKids ? adaptSpeed : stagedSpeed;
  // Kids: no tricks. Adults: stage lookup trick rate; elite: 65%.
  const trickRate = isKids ? 0 : elite ? 0.65 : stageFor(level).trick;
  // Random per command: initialized trick-free for kids, coin-flip adults.
  // Every draw after uses trickRate (elite 65%).
  // Initial command + no-repeat history.
  const [commandId, setCommandId] = useState<string>(() =>
    pool[Math.floor(Math.random() * pool.length)],
  );
  // Kids ALWAYS hear the prefix (spec: trick-free). Adults coin-flip.
  const [simonSaysIt, setSimonSaysIt] = useState<boolean>(() => true);
  const [simonInit, setSimonInit] = useState(false);
  useEffect(() => {
    if (simonInit) return;
    setSimonInit(true);
    if (!isKids) setSimonSaysIt(Math.random() < 0.5);
  }, [isKids, simonInit]);
  const commandSound = useSoundFile(commandFile(voice, commandId, simonSaysIt));
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cameraRef = useRef<CameraType | null>(null);
  // Live phase mirror for async callbacks (avoids stale closure reads).
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  // Previous verified frame: every move is judged against the frame right
  // before it (did you JUST move?). Advances ONLY on verified frames —
  // a failed flail never becomes the new baseline (Wonder: no poisoning).
  const prevBoxRef = useRef<SamBox | null>(null);
  // Run-session id: invalidates stale async callbacks after OUT/unmount.
  const runIdRef = useRef(0);
  // Elapsed active seconds (real, not the chosen duration) for progress log.
  const elapsedRef = useRef(0);
  // Per-OCCURRENCE kid tries (Wonder: keyed by occurrence, reset per instance).
  const kidTriesRef = useRef<{ n: number }>({ n: 0 });
  // SAM burst buffer: SEQUENCE-TAGGED frames for the CURRENT command only.
  // Entries carry their cmdSeq; scoring filters to the active sequence, so
  // late frames can never leak into the next command (Wonder fix #2).
  const burstRef = useRef<{ box: SamBox; seq: number; t: number }[]>([]);
  const cmdSeqRef = useRef(0);
  const autoRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirror paused into a ref so async callbacks see it without re-subscribing.
  // Declared BEFORE the mirror effect (Wonder tsc: used-before-declaration).
  const [unverified, setUnverified] = useState(0);
  const unverifiedRef = useRef(0);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  const [verdict, setVerdict] = useState('SAM idle — add key in Settings');
  // Live SAM outline for judges: latest box + detected signature rendered
  // as a bordered overlay on the selfie. State (not ref) so it re-renders.
  const [liveBox, setLiveBox] = useState<SamBox | null>(null);
  const [liveSign, setLiveSign] = useState<SignMatch | null>(null);
  // BlazePose landmark overlay (33 joints, purple dots). Populated only
  // when the pose frame-processor plugin is live; otherwise stays null.
  // idle → scanning → locked | unavailable. No more samOn boolean.
  const [restBox, setRestBox] = useState<SamBox | null>(null);
  const [samStatus, setSamStatus] = useState<SamStatus>('idle');
  // Losing parameters (adults, sudden death — first miss ends the run):
  // - NO MOVE: SAM box unchanged vs previous verified frame
  // - JERKY FLAIL: SAM box-trajectory jerk > 0.6 even if the box changed
  // - TRAP: moved on a bare command (no "Simon says") — classic Simon out
  // - FIRST COMMAND: same rules from move #1 — no warm-up immunity
  // Kids: none lose — 3 tries, always passes, no OUT screen.
  // UNVERIFIED: immediate pause + auto-retry countdown (fix #1), never a loss.
  const [failed, setFailed] = useState(false);
  const [loseReason, setLoseReason] = useState('');
  // SAM cost honesty (Wonder fix #4): count calls + bytes per run, shown
  // on the YOU LOSE card. Silent full-res fallback is now visible.
  const samCallsRef = useRef(0);
  const samBytesRef = useRef(0);
  // stage 4+, 1-in-3 from stage 7+ (training lengths stay affordable).
  // Sampled-off commands auto-pass on the honor tick (no SAM call).
  const shouldSample = (cmdIndex: number): boolean => {
    const st = Math.min(level, MAX_STAGE);
    if (st >= 7) return cmdIndex % 3 === 0;
    if (st >= 4) return cmdIndex % 2 === 0;
    return true;
  };const registerMiss = (why: string) => {
    setStreak(0);
    Vibration.vibrate([0, 250, 100, 400]);
    if (isKids) {
      setVerdict(`❌ try again! (${why})`);
      return;
    }
    setFailed(true);
    setLoseReason(why);
    setPhase('done');
    setVerdict(`💀 OUT — ${why}`);
  };
  // Selfie camera (new vision: user sees themselves, listens to audio only).
  // Wonder fix: permission was NEVER requested — hasPermission stayed false
  // forever, so the Camera never mounted and mapping looped on "no camera
  // reading". Request once on mount; denied = explicit blocked card.
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('front');
  useEffect(() => {
    if (!hasPermission) requestPermission().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load persisted SAM key once (Wonder: no globalThis smuggling).
  useEffect(() => {
    loadSamKey().catch(() => {});
  }, []);

  // Map-first get-ready: NO countdown until SAM sees the right framing.
  // gatePhase 'mapping' (new): SAM snapshots every ~2s on arrival; when the
  // box matches the mode (easy/kids=upper, hard=full, bootcamp=full+floor)
  // the 10s timer starts and median-baseline collection begins.
  // Countdown NEVER runs blind — mapping gates it.
  // Pose library enrollment (handoff §2): runs AFTER mapping lock and BEFORE
  // the countdown. Mapping -> enrolling -> countdown -> playing -> done.
  type GatePhase = 'mapping' | 'calibrating' | 'enrolling' | 'countdown' | 'playing' | 'done';
  const [gatePhase, setGatePhase] = useState<GatePhase>('mapping');
  // mapOk/mapMsg live beside gatePhase (Wonder tsc: used-before-declaration).
  const [mapOk, setMapOk] = useState(false);
  const [mapMsg, setMapMsg] = useState('');
  // Mode framing requirements: fraction of frame the person box must cover.
  // easy/kids = upper body close-up (large box); hard = full body (medium);
  // bootcamp = full body + floor space below (medium box, low in frame).
  const frameNeed = useMemo(() => {
    if (gameMode === 'bootcamp') return { minArea: 0.12, maxArea: 0.6, needLow: true, label: 'FULL body + floor in frame' };
    if (gameMode === 'kids' || voice === 'female') return { minArea: 0.18, maxArea: 0.9, needLow: false, label: 'face + shoulders big in frame' };
    return { minArea: 0.12, maxArea: 0.6, needLow: false, label: 'FULL body head-to-toe' };
  }, [gameMode, voice]);
  const mapCheck = (box: SamBox | null): { ok: boolean; msg: string } => {
    if (!box) return { ok: false, msg: 'no person found — step into frame' };
    const area = Math.max(0, box.x2 - box.x1) * Math.max(0, box.y2 - box.y1) / Math.max(1, box.w * box.h);
    const cy = (box.y1 + box.y2) / 2 / Math.max(1, box.h);
    if (area < frameNeed.minArea) return { ok: false, msg: `too small (${Math.round(area * 100)}%) — move closer` };
    if (area > frameNeed.maxArea) return { ok: false, msg: `too close (${Math.round(area * 100)}%) — step back` };
    if (frameNeed.needLow && cy < 0.45) return { ok: false, msg: 'show the floor below you — tilt down' };
    return { ok: true, msg: `${frameNeed.label} ✅` };
  };
  // Mapping loop: snapshot every ~2s until framing matches, then countdown.
  useEffect(() => {
    if (phase !== 'getready' || gatePhase !== 'mapping') return;
    let cancelled = false;
    const runId = ++runIdRef.current;
    setSamStatus('scanning');
    setVerdict('🔍 SAM mapping your framing…');
    (async () => {
      while (!cancelled && runIdRef.current === runId) {
        const snap = await snapSmall();
        if (cancelled || runIdRef.current !== runId) return;
        if (snap) {
          samCallsRef.current += 1;
          samBytesRef.current += snap.bytes;
          try {
            const { text } = await segmentPerson(snap.b64);
            if (cancelled || runIdRef.current !== runId) return;
            const box = pickBox(parseSamBoxes(text), baseSamplesRef.current[0] ?? null);
            const chk = mapCheck(box);
            setMapOk(chk.ok);
            setMapMsg(chk.msg);
            setVerdict(chk.ok ? `✅ ${chk.msg} — starting…` : `📷 ${chk.msg}`);
            if (box) baseSamplesRef.current.push(box);
            if (chk.ok && box) {
              const { medianBaseline } = await import('../sam/verifier');
              const locked = medianBaseline(baseSamplesRef.current);
              setRestBox(locked ?? box);
              prevBoxRef.current = locked ?? box;
              setSamStatus('locked');
              // Framing locked — hand off to pose-library enrollment, NOT
              // the countdown. Profile gates the 10s timer (Wonder spec).
              // Enrollment gates profile creation. Order: enroll -> profile.
              if (calibSkipped || enrollmentWaived || poseLib) {
                if (calibSkipped || enrollmentWaived || profile) {
                  setCount(10);
                  setGatePhase('countdown');
                } else {
                  beginCalibrating();
                }
              } else {
                beginEnrolling();
              }
              return;
            }
          } catch {
            setMapOk(false);
            setMapMsg('SAM hiccup — retrying…');
            setVerdict('⏸️ SAM hiccup — retrying…');
          }
        } else {
          setMapOk(false);
          setMapMsg('no camera reading — stay in frame');
        }
        await new Promise<void>(r => setTimeout(() => r(), 2000));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, gatePhase, gameMode]);
  // Personal calibration profile (Wonder spec): loaded per run, gates the
  // countdown, scales thresholds. Null = global defaults (thresholdScale=1).
  const [profile, setProfile] = useState<CalibrationProfile | null>(null);
  // Pose library enrollment state (pre-game stored templates + live markers).
  const [poseLib, setPoseLib] = useState<import('../sam/poseLibrary').PoseLibrary | null>(null);
  const [enrollIdx, setEnrollIdx] = useState(0);
  const [enrollMsg, setEnrollMsg] = useState('');
  const [enrollMissing, setEnrollMissing] = useState<string[]>([]);
  const [enrollmentWaived, setEnrollmentWaived] = useState(false);
  const [poseMark, setPoseMark] = useState<{ x: number; y: number; zone: string } | null>(null);
  const [matchPct, setMatchPct] = useState<number | null>(null);
  const [judgingMode, setJudgingMode] = useState<'library' | 'default'>('default');
  // Revalidation spot-checks (handoff §6): 2 random stored poses only.
  const [revalChecks, setRevalChecks] = useState<string[]>([]);
  const [revalIdx, setRevalIdx] = useState(0);
  const [revalPassed, setRevalPassed] = useState(0);
  const enrollBoxesRef = useRef<{ commandId: string; boxes: import('../sam/verifier').SamBox[]; attempts: number } | null>(null);
  const [calibIdx, setCalibIdx] = useState(0);
  const [calibMsg, setCalibMsg] = useState('');
  const calibSteps = useMemo(() => calibrationSteps(isKids), [isKids]);
  const calibScale = useMemo(() => thresholdScale(profile), [profile]);
  // Calibrating runner state: per-step SAM marks + guided snapshots.
  const [calibZones, setCalibZones] = useState<Partial<Record<string, { x: number; y: number; w: number; h: number }>>>({});
  const [calibSkipped, setCalibSkipped] = useState(false);
  const calibSamplesRef = useRef<{ step: CalibStep; box: SamBox }[]>([]);
  // Spark advisory (stats-only, never images): per-stage tip + end-of-run line.
  // Stage-bounded: ±1 level, ±10pp trick nudge — never jumps the ramp.
  // Persistent posture (Wonder P2): stage delta applies at the NEXT boundary
  // but the trick posture persists across stages until fresh live advice
  // replaces it — labelled "next-stage nudge" so judges see the horizon.
  const [sparkTip, setSparkTip] = useState('');
  const [sparkLive, setSparkLive] = useState(false);
  const [sparkSource, setSparkSource] = useState('local');
  const [sparkAt, setSparkAt] = useState(0);
  const [sparkLatency, setSparkLatency] = useState(0); // Wonder P2: show responsiveness beside live tag
  const [sparkNote, setSparkNote] = useState('');
  const [sparkNoteLive, setSparkNoteLive] = useState(false);
  const [recalibrate, setRecalibrate] = useState(false);
  const [sparkStageDelta, setSparkStageDelta] = useState<0 | 1 | -1>(0);
  const [sparkTrickNudge, setSparkTrickNudge] = useState(0); // ±0.1 applied to trick coin-flip
  // Wonder P1: single effective-trick accessor — EVERY coin-flip consumes
  // the persistent Spark posture. Declared AFTER sparkTrickNudge state
  // (no TDZ), used by timer boundary + advance + retry/next resets.
  const sparkLatencyRef = useRef(0);
  const effTrickRate = (base: number = trickRate): number => Math.max(0, Math.min(0.8, base + sparkTrickNudge));
  // Load the persisted calibration profile once per mount. Fresh installs
  // fall back to global thresholds (scale=1) until the first guided run.
  useEffect(() => {
    loadCalibrationProfile().then(p => { if (p) setProfile(p); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (phase !== 'getready' || gatePhase !== 'countdown') return;
    if (count <= 0) {
      setPhase('playing');
      setTimeLeft(duration);
      return;
    }
    const t = setTimeout(() => setCount(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [count, phase, gatePhase]);

  // Guided calibrating runner: mapping handed us a framed box; now walk
  // the kid/adult steps, one SAM mark per step. Step 'still' builds the
  // neutral baseline; pose/step entries record deltas from neutral. When
  // the last step locks, build + persist the profile and open the
  // countdown gate. Skip = global defaults (scale 1), never a loss.
  useEffect(() => {
    if (phase !== 'getready' || gatePhase !== 'calibrating') return;
    const step = calibSteps[calibIdx];
    if (!step) return;
    let cancelled = false;
    const runId = ++runIdRef.current;
    setSamStatus('scanning');
    setCalibMsg(step.kind === 'still' ? 'hold still…' : 'follow the pose, hold it…');
    setVerdict(`🧭 ${step.instruction}`);
    (async () => {
      // Each step gets ~4s to settle, then one SAM mark.
      await new Promise<void>(r => setTimeout(() => r(), 4000));
      if (cancelled || runIdRef.current !== runId) return;
      try {
        const snap = await snapSmall();
        if (!snap || cancelled || runIdRef.current !== runId) return;
        samCallsRef.current += 1;
        samBytesRef.current += snap.bytes;
        const { text } = await segmentPerson(snap.b64);
        if (cancelled || runIdRef.current !== runId) return;
        const box = pickBox(parseSamBoxes(text), prevBoxRef.current ?? restBox);
        if (cancelled || runIdRef.current !== runId) return;
        if (!box) {
          setCalibMsg('no mark — retrying this step…');
          setVerdict('⏸️ no silhouette — hold the pose…');
          await new Promise<void>(r => setTimeout(() => r(), 1500));
          if (!cancelled && runIdRef.current === runId) setCalibIdx(i => i);
          return;
        }
        calibSamplesRef.current.push({ step, box });
        setLiveBox(box);
        // Zone marks: render the touched zone for this + side steps.
        if (step.zone && restBox) {
          try {
            const z = zoneRectClamped(restBox, step.zone as any);
            setCalibZones(prev => ({ ...prev, [step.zone as string]: z }));
          } catch { /* mark skipped — overlay is advisory only */ }
        }
        setCalibMsg('mark locked ✅');
        await new Promise<void>(r => setTimeout(() => r(), 600));
        if (cancelled || runIdRef.current !== runId) return;
        const next = calibIdx + 1;
        if (next >= calibSteps.length) {
          finishCalibration();
        } else {
          setCalibIdx(next);
        }
      } catch {
        if (!cancelled && runIdRef.current === runId) {
          setCalibMsg('network hiccup — retrying this step…');
          setVerdict('⏸️ SAM hiccup — holding this step…');
          await new Promise<void>(r => setTimeout(() => r(), 1500));
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, gatePhase, calibIdx]);

  const finishCalibration = () => {
    const samples = calibSamplesRef.current;
    const stills = samples.filter(s => s.step.kind === 'still').map(s => s.box);
    const locked = ((): SamBox | null => {
      if (stills.length >= 2) {
        const m = medianBaseline(stills);
        if (m) return m;
      }
      if (samples.length >= 2) return medianBaseline(samples.map(s => s.box));
      return samples[0]?.box ?? restBox;
    })();
    // Personal deltas: how big THIS player's raise/crouch/steps are vs
    // neutral. Median supporter logic reused from the baseline lock.
    const growOf = (b: SamBox, n: SamBox | null): number | null => {
      if (!n) return null;
      const a0 = Math.max(1, (n.x2 - n.x1) * (n.y2 - n.y1));
      const a1 = Math.max(0, (b.x2 - b.x1) * (b.y2 - b.y1));
      const g = Math.abs(a1 - a0) / a0;
      return Number.isFinite(g) ? g : null;
    };
    const shiftOf = (b: SamBox, n: SamBox | null): number | null => {
      if (!n) return null;
      const dx = (b.x1 + b.x2) / 2 / Math.max(1, b.w) - (n.x1 + n.x2) / 2 / Math.max(1, n.w);
      const dy = (b.y1 + b.y2) / 2 / Math.max(1, b.h) - (n.y1 + n.y2) / 2 / Math.max(1, n.h);
      const s = Math.hypot(dx, dy);
      return Number.isFinite(s) ? s : null;
    };
    const raiseBoxes = samples.filter(s => s.step.id === 'raise').map(s => s.box);
    const crouchBoxes = samples.filter(s => s.step.id === 'crouch').map(s => s.box);
    const stepBoxes = samples.filter(s => s.step.kind === 'step').map(s => s.box);
    const med = (xs: (number | null)[]): number | null => {
      const v = xs.filter((x): x is number => x != null && x > 0).sort((a, b) => a - b);
      return v.length ? v[Math.floor(v.length / 2)] : null;
    };
    const neutral = locked ?? restBox;
    const neutralArea = neutral ? (Math.max(0, (neutral.x2 - neutral.x1) * (neutral.y2 - neutral.y1)) / Math.max(1, neutral.w * neutral.h)) : 0.2;
    const p: CalibrationProfile = {
      version: 1,
      mode: gameMode,
      updatedAt: Date.now(),
      rest: locked ?? restBox,
      neutralArea,
      neutralAspect: neutral ? Math.max(0.01, (neutral.x2 - neutral.x1) / Math.max(1, neutral.y2 - neutral.y1)) : 0.7,
      neutralCx: neutral ? (neutral.x1 + neutral.x2) / 2 / Math.max(1, neutral.w) : 0.5,
      neutralCy: neutral ? (neutral.y1 + neutral.y2) / 2 / Math.max(1, neutral.h) : 0.5,
      // Left/right mapping: front camera mirrors — the image side the
      // player touched for THEIR right ear decides the flip bit.
      leftIsImageRight: (() => {
        const touchR = samples.find(s => s.step.id === 'touchR');
        if (!touchR?.box || !restBox) return true;
        const cx = (touchR.box.x1 + touchR.box.x2) / 2;
        const mid = (restBox.x1 + restBox.x2) / 2;
        return cx >= mid;
      })(),
      zones: { ...calibZones } as CalibrationProfile['zones'],
      armsUpDelta: med(raiseBoxes.map(b => growOf(b, neutral))),
      crouchDelta: med(crouchBoxes.map(b => growOf(b, neutral))),
      stepDelta: med(stepBoxes.map(b => shiftOf(b, neutral))),
      confidence: samples.length >= calibSteps.length ? 0.85 : samples.length >= 3 ? 0.6 : 0.4,
    };
    setProfile(p);
    saveCalibrationProfile(p).catch(() => {});
    if (locked) {
      setRestBox(locked);
      prevBoxRef.current = locked;
    }
    setSamStatus('locked');
    setCount(10);
    setGatePhase('countdown');
    setVerdict('✅ profile saved — hold still…');
  };

  // Mapping hands off to calibrating (profile-gated countdown): mapping
  // locks the framing box, calibrating walks the guided steps, and only
  // the finished profile opens the 10s countdown. Skip keeps scale=1.
  const beginCalibrating = () => {
    calibSamplesRef.current = [];
    setCalibIdx(0);
    setCalibMsg('');
    setCalibSkipped(false);
    setRecalibrate(false);
    setGatePhase('calibrating');
  };
  const skipCalibration = () => {
    setCalibSkipped(true);
    setCount(10);
    setGatePhase('countdown');
    setVerdict('⏩ skipped setup — default sensitivity');
  };

  // Pose-library enrollment (handoff §2-§3): runs AFTER mapping lock,
  // BEFORE countdown. Player performs each pool pose; SAM stores the
  // reference template + SAM zone marker. Honest: markers are zones / HR
  // change-regions, never joints. Facial commands share the head zone.
  const enrollPool = useMemo(() => [...pool] as string[], [pool]);
  const enrollTotal = enrollPool.length;
  const beginEnrolling = async () => {
    const { loadPoseLibrary } = await import('../sam/poseLibrary');
    const existing = await loadPoseLibrary(gameMode).catch(() => null);
    setEnrollIdx(0);
    setEnrollMsg('');
    setEnrollMissing([]);
    setPoseMark(null);
    setMatchPct(null);
    setEnrollmentWaived(false);
    setRevalChecks([]);
    setRevalIdx(0);
    setRevalPassed(0);
    enrollBoxesRef.current = null;
    if (existing && Object.keys(existing.templates).length > 0) {
      // Revalidation path (handoff §6): 2 random pose spot-checks.
      // Full re-enroll if either check fails.
      const keys = Object.keys(existing.templates);
      const shuffled = [...keys].sort(() => Math.random() - 0.5);
      const checks = shuffled.slice(0, Math.min(2, keys.length));
      setRevalChecks(checks);
      setRevalIdx(0);
      setRevalPassed(0);
      setPoseLib(existing);
      setJudgingMode('library');
      setVerdict('📚 Stored pose library found — quick check…');
      setGatePhase('enrolling');
      setEnrollIdx(-1); // -1 = revalidation mode
      return;
    }
    setJudgingMode('library');
    setGatePhase('enrolling');
  };
  const skipEnrollment = () => {
    setEnrollmentWaived(true);
    setJudgingMode('default');
    if (calibSkipped || profile) {
      setCount(10);
      setGatePhase('countdown');
    } else {
      beginCalibrating();
    }
    setVerdict('⏩ skipped pose library — default judging');
  };
  const finishEnrollment = async () => {
    const { savePoseLibrary, emptyLibrary, buildTemplate, adaptiveThreshold } = await import('../sam/poseLibrary');
    const neutral = restBox ?? prevBoxRef.current;
    if (!neutral) {
      skipEnrollment();
      return;
    }
    const lib = emptyLibrary(gameMode, neutral, true, frameNeed.label);
    const boxes = (enrollBoxesRef as any).all as { commandId: string; box: import('../sam/verifier').SamBox }[] | undefined;
    const collected: { commandId: string; box: import('../sam/verifier').SamBox }[] = boxes ?? [];
    for (const { commandId, box } of collected) {
      try {
        lib.templates[commandId] = buildTemplate(commandId, box, neutral, true);
      } catch { /* skip bad template */ }
    }
    const tpls = Object.values(lib.templates);
    if (tpls.length === 0) {
      skipEnrollment();
      return;
    }
    lib.passThreshold = adaptiveThreshold(tpls, neutral);
    await savePoseLibrary(lib);
    setPoseLib(lib);
    setJudgingMode('library');
    setVerdict(`📚 Pose library ready: ${tpls.length}/${enrollTotal} poses · match bar ${Math.round(lib.passThreshold * 100)}%`);
    // Enrollment gates calibration + countdown: build the old profile next
    // so thresholdScale still scales judgeMove thresholds.
    if (calibSkipped || profile) {
      setCount(10);
      setGatePhase('countdown');
    } else {
      beginCalibrating();
    }
  };

  // Per-pose enrollment runner: one SAM mark per pool pose (§3).
  // Mirrors the calibrating runner (runId guards, retries, cancelled flags).
  useEffect(() => {
    if (phase !== 'getready' || gatePhase !== 'enrolling') return;
    if (enrollIdx < 0) {
      // Revalidation mode (handoff §6): run spot-checks inline here.
      // Two random stored poses, one snapshot each; both must match.
      if (revalChecks.length === 0) return;
      if (revalIdx >= revalChecks.length) {
        if (revalPassed >= revalChecks.length) {
          setVerdict('📚 Welcome back — pose library still fits ✅');
          setPoseMark(null);
          if (calibSkipped || profile) {
            setCount(10);
            setGatePhase('countdown');
          } else {
            beginCalibrating();
          }
        } else {
          setEnrollIdx(0); // fall through to full re-enroll
        }
        return;
      }
      const checkId = revalChecks[revalIdx];
      if (!checkId) { setRevalIdx(i => i + 1); return; }
      let cancelled = false;
      const runId = ++runIdRef.current;
      setSamStatus('scanning');
      setEnrollMsg(`Quick check ${revalIdx + 1}/${revalChecks.length} — hold: ${checkId.replace(/_/g, ' ')}`);
      setVerdict(`📚 Quick check: ${checkId.replace(/_/g, ' ')} — hold it…`);
      (async () => {
        try {
          const { pickBox: pickB, parseSamBoxes: parseB, segmentPerson: segP } = await import('../sam/verifier');
          const { matchScore: matchFn } = await import('../sam/poseLibrary');
          await new Promise<void>(r => setTimeout(() => r(), 2500));
          if (cancelled || runIdRef.current !== runId) return;
          const snap = await snapSmall();
          if (!snap || cancelled || runIdRef.current !== runId) return;
          samCallsRef.current += 1;
          samBytesRef.current += snap.bytes;
          const { text } = await segP(snap.b64);
          if (cancelled || runIdRef.current !== runId) return;
          const liveBox = pickB(parseB(text), restBox ?? prevBoxRef.current);
          if (!liveBox || !poseLib) {
            if (!cancelled && runIdRef.current === runId) setEnrollIdx(0);
            return;
          }
          const tpl = (poseLib.templates as Record<string, import('../sam/poseLibrary').PoseTemplate>)[checkId];
          if (!tpl) {
            if (!cancelled && runIdRef.current === runId) setEnrollIdx(0);
            return;
          }
          const m = matchFn(liveBox, poseLib.neutralBox, restBox, tpl);
          const bar = poseLib.passThreshold ?? 0.72;
          const ok = m.total >= bar - 0.05;
          setPoseMark(tpl.marker ? { x: tpl.marker.x, y: tpl.marker.y, zone: String(tpl.marker.zone) } : null);
          setLiveBox(liveBox);
          if (ok) setRevalPassed(p => p + 1);
          await new Promise<void>(r => setTimeout(() => r(), 800));
          if (!cancelled && runIdRef.current === runId) setRevalIdx(i => i + 1);
        } catch {
          if (!cancelled && runIdRef.current === runId) setEnrollIdx(0);
        }
      })();
      return () => { cancelled = true; };
    }
    if (enrollIdx >= enrollTotal) {
      finishEnrollment();
      return;
    }
    const commandId = enrollPool[enrollIdx];
    if (!commandId) {
      finishEnrollment();
      return;
    }
    let cancelled = false;
    const runId = ++runIdRef.current;
    setSamStatus('scanning');
    setEnrollMsg('Get ready…');
    setVerdict(`📚 POSE LIBRARY ${enrollIdx + 1}/${enrollTotal} — ${commandId.replace(/_/g, ' ')}`);
    enrollBoxesRef.current = { commandId, boxes: [], attempts: 0 };
    // Play the existing command audio for this pose (handoff §3.1).
    // Released on unmount/cancel (Wonder: no leaked Sound on back-out).
    let enrollSound: Sound | null = null;
    try {
      enrollSound = new Sound(commandFile(voice, commandId, true), Sound.MAIN_BUNDLE, () => {});
      enrollSound.play(() => { try { enrollSound?.release(); } catch { /* noop */ } enrollSound = null; });
    } catch { /* audio missing — text instruction still shows */ }
    (async () => {
      try {
        const { pickBox: pickB, parseSamBoxes: parseB, segmentPerson: segP } = await import('../sam/verifier');
        const { computeMarker } = await import('../sam/poseLibrary');
        const readyMs = isKids ? 2000 : 3000;
        const holdGapMs = 700;
        const maxAttempts = 3;
        await new Promise<void>(r => setTimeout(() => r(), readyMs));
        if (cancelled || runIdRef.current !== runId) return;
        setEnrollMsg('Hold it…');
        const boxes: import('../sam/verifier').SamBox[] = [];
        let attempts = 0;
        let resets = 0; // Wonder: bounded disagreement retries (stall fix)
        const maxResets = 3;
        while (boxes.length < 2 && attempts < maxAttempts && resets <= maxResets) {
          if (cancelled || runIdRef.current !== runId) return;
          attempts += 1;
          await new Promise<void>(r => setTimeout(() => r(), holdGapMs));
          if (cancelled || runIdRef.current !== runId) return;
          const snap = await snapSmall();
          if (!snap) continue;
          samCallsRef.current += 1;
          samBytesRef.current += snap.bytes;
          try {
            const { text } = await segP(snap.b64);
            if (cancelled || runIdRef.current !== runId) return;
            const b = pickB(parseB(text), restBox ?? prevBoxRef.current);
            if (!b) continue;
            setLiveBox(b);
            boxes.push(b);
            if (boxes.length >= 2) {
              const { default: _ } = { default: null };
              void _;
              const a = boxes[0]!;
              const c = boxes[1]!;
              const ix = Math.max(a.x1, c.x1);
              const iy = Math.max(a.y1, c.y1);
              const ax = Math.min(a.x2, c.x2);
              const ay = Math.min(a.y2, c.y2);
              const inter = Math.max(0, ax - ix) * Math.max(0, ay - iy);
              const ua = Math.max(1, (a.x2 - a.x1) * (a.y2 - a.y1) + (c.x2 - c.x1) * (c.y2 - c.y1) - inter);
              const iou = inter / ua;
              if (iou < 0.4) {
                boxes.length = 0; // disagree — retry both snapshots
                resets += 1;
                if (resets > maxResets) break; // stall guard: mark MISSING
              }
            }
          } catch {
            continue;
          }
        }
        if (cancelled || runIdRef.current !== runId) return;
        if (boxes.length < 2) {
          // 3 failed attempts: mark MISSING, excluded from this run (§3.5).
          setEnrollMissing(m => [...m, commandId]);
          setEnrollMsg('Skipped — could not get a clear mark');
          await new Promise<void>(r => setTimeout(() => r(), 600));
          if (!cancelled && runIdRef.current === runId) setEnrollIdx(i => i + 1);
          return;
        }
        const agreed = boxes[1]!;
        const neutral = restBox ?? prevBoxRef.current ?? agreed;
        const marker = computeMarker(commandId, neutral, agreed);
        setPoseMark({ x: marker.x, y: marker.y, zone: String(marker.zone) });
        setLiveBox(agreed);
        prevBoxRef.current = agreed;
        const all = ((enrollBoxesRef as any).all ?? []) as { commandId: string; box: import('../sam/verifier').SamBox }[];
        all.push({ commandId, box: agreed });
        (enrollBoxesRef as any).all = all;
        setEnrollMsg(`Stored ✅ SAM marked your ${String(marker.zone)} zone`);
        await new Promise<void>(r => setTimeout(() => r(), 600));
        if (!cancelled && runIdRef.current === runId) setEnrollIdx(i => i + 1);
      } catch {
        if (!cancelled && runIdRef.current === runId) {
          setEnrollMissing(m => [...m, commandId]);
          setEnrollIdx(i => i + 1);
        }
      }
    })();
    return () => { cancelled = true; try { enrollSound?.release(); } catch { /* noop */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, gatePhase, enrollIdx, revalIdx]);

  // Median top-up during countdown (the 10s IS the baseline window now):
  // extra samples refine the locked box; median needs 2+ supporters.
  const baseSamplesRef = useRef<SamBox[]>([]);
  useEffect(() => {
    if (phase !== 'getready' || gatePhase !== 'countdown') return;
    if (count !== 7 && count !== 4 && count !== 1) return;
    const runId = ++runIdRef.current;
    let cancelled = false;
    setSamStatus(s => (s === 'locked' ? s : 'scanning'));
    (async () => {
      const b64 = await snapBase64();
      if (!b64 || cancelled || runIdRef.current !== runId) return;
      try {
        const { text } = await segmentPerson(b64);
        const box = pickBox(parseSamBoxes(text), baseSamplesRef.current[0] ?? null);
        if (cancelled || runIdRef.current !== runId) return;
        if (box) {
          baseSamplesRef.current.push(box);
          const samples = baseSamplesRef.current;
          // True median-agreement baseline (Wonder fix): component-wise
          // median of agreeing samples, outliers dropped. Lock only when
          // the median has 2+ supporters — never a single mid-motion frame.
          const locked = medianBaseline(samples);
          if (locked) {
            setRestBox(locked);
            prevBoxRef.current = locked;
            setSamStatus('locked');
            setVerdict('SAM locked ✅ hold still…');
          }
        }
      } catch (e: any) {
        if (!cancelled && runIdRef.current === runId && count === 1) {
          setSamStatus('unavailable');
          setVerdict('SAM unreachable — will retry when playing');
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, count, gatePhase]);

  // Snapshot helper (Wonder fix #4): takePhoto → NATIVE resize to ≤320px
  // JPEG q70 via react-native-image-resizer → manual base64. No canvas or
  // FileReader (web APIs, absent on device). Bytes returned for cost logging.
  const snapSmall = async (): Promise<{ b64: string; bytes: number } | null> => {
    try {
      const cam = cameraRef.current;
      if (!cam) return null;
      const photo: any = await (cam as any).takePhoto({ flash: 'off', enableShutterSound: false });
      let uri = `file://${photo.path}`;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Resizer = require('react-native-image-resizer').default;
        const resized: any = await Resizer.createResizedImage(uri, 320, 320, 'JPEG', 70, 0, undefined, false, { mode: 'contain' });
        if (resized?.uri) uri = resized.uri.startsWith('file://') ? resized.uri : `file://${resized.uri}`;
      } catch { /* resizer missing — send raw, SAM downscales server-side */ }
      const resp: any = await fetch(uri);
      const buf: ArrayBuffer = await resp.arrayBuffer();
      const bytes = new Uint8Array(buf);
      // Manual base64 (chunked, stack-safe) — no btoa/Buffer dependency.
      const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      let out = '';
      for (let i = 0; i < bytes.length; i += 3) {
        const a = bytes[i];
        const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
        const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
        const n = (a << 16) | (b << 8) | c;
        out += ALPHA[(n >> 18) & 63] + ALPHA[(n >> 12) & 63] + (i + 1 < bytes.length ? ALPHA[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? ALPHA[n & 63] : '=');
      }
      if (!out) return null;
      return { b64: out, bytes: bytes.length };
    } catch {
      return null;
    }
  };
  const snapBase64 = async (): Promise<string | null> => (await snapSmall())?.b64 ?? null;

  // Capture resting silhouette when play starts (backup if get-ready missed).
  // Get-ready already tries at 3s/6s/9s; this fires only when still unlocked.
  // UNVERIFIED (Wonder): network/API faults pause with a retry pill —
  // only proven FAIL_MOVE ends the run.
  useEffect(() => {
    if (phase !== 'playing') return;
    if (restBox) return; // get-ready already locked it
    const runId = ++runIdRef.current;
    let cancelled = false;
    setSamStatus(s => (s === 'locked' ? s : 'scanning'));
    (async () => {
      await new Promise<void>(r => setTimeout(() => r(), 1200));
      if (cancelled || runIdRef.current !== runId) return;
      const b64 = await snapBase64();
      if (!b64 || cancelled || runIdRef.current !== runId) return;
      try {
        const { text } = await segmentPerson(b64);
        if (cancelled || runIdRef.current !== runId) return;
        const box = pickBox(parseSamBoxes(text), null);
        if (box) {
          setRestBox(box);
          prevBoxRef.current = box;
          setSamStatus('locked');
          setVerdict('SAM watching 👀');
        } else {
          setSamStatus('unavailable');
          setVerdict('⏸️ no silhouette — hold still to retry');
        }
      } catch (e: any) {
        if (!cancelled && runIdRef.current === runId) {
          setSamStatus('unavailable');
          const msg = e?.code === 'no-key' || String(e?.message) === 'no-key'
            ? 'Add your SAM key in Settings, then retry'
            : '⏸️ network hiccup — retrying, not a loss';
          setVerdict(msg);
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, level]);
  useEffect(() => {
    if (phase !== 'playing' || paused) return;
    const startedAt = Date.now();
    timerRef.current = setInterval(() => {
      elapsedRef.current += 1;
      const left = Math.max(0, duration - elapsedRef.current);
      setTimeLeft(left);
      if (left <= 0) {
        if (timerRef.current) clearInterval(timerRef.current);
        // Endless run: timer expiry auto-advances to the next stage.
        // Spark stage delta applies HERE only (Wonder P1): bounded ±1, so
        // Spark can nudge but never jump the ramp or override SAM verdicts.
        // Pure transition OUTSIDE the updater (Wonder: setState in updater).
        elapsedRef.current = 0;
        setOverLogged(false);
        const p = poolFor(voice, gameMode);
        const next = drawCommand(p, recent);
        pushRecent(next);
        setCommandId(next);
        setSimonSaysIt(isKids ? true : Math.random() < effTrickRate());
        // Persistent posture (Wonder P2): stage delta is one-shot (consumed
        // here = "next-stage nudge"), trick posture persists until fresh
        // live advice replaces it — Spark can hold a trick style all stage.
        const bounded = sparkStageDelta === 1 ? 1 : sparkStageDelta === -1 ? -1 : 0;
        setSparkStageDelta(0);
        setLevel(l => Math.max(1, Math.min(l + 1 + bounded, 999)));
        setStageFlash(true);
        setTimeLeft(duration);
        setPlayKey(k => k + 1);
        void startedAt;
      }
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, level, duration, paused]);

  // Play each command at level speed; chain the next one when it ends.
  // SAM burst (Wonder): 2 snapshots DURING the audio (40% + 80% through),
  // judged on max delta from the previous verified frame — catches the
  // action mid-flight instead of post-action drift. Falls back to the
  // gap snapshot when the command is shorter than the burst schedule.
  // Verdicts: expected 'move' (Simon says) vs 'freeze' (bare trap).
  // UNVERIFIED pauses with retry pill; only FAIL_MOVE ends the run.
  useEffect(() => {
    if (phase !== 'playing') return;
    const expected: 'move' | 'freeze' = isKids ? 'move' : simonSaysIt ? 'move' : 'freeze';
    setCommandLabel(expected === 'move' ? `🗣️ Simon says… (${speed.toFixed(2)}x)` : `🗣️ Freeze… (${speed.toFixed(2)}x)`);
    const s = commandSound.sound.current;
    // Wonder: gate on load — play() before load stalls the chain silently.
    if (!s || !commandSound.loaded) {
      if (!s) return;
      setCommandLabel('⏳ loading audio…');
      const retry = setTimeout(() => setPlayKey(k => k + 1), 600);
      return () => clearTimeout(retry);
    }
    try { s.setSpeed(speed); } catch { /* older devices: ignore, play normal */ }
    // Kids: generous 2.2s base gap. Adults: stage gap; elite floor 0.35s.
    const eliteNow = !isKids && tries >= 8 && (tries === 0 ? 1 : hits / tries) >= 0.8;
    const gap = isKids ? 2.2 : Math.max(eliteNow ? 0.35 : stageFor(level).gap, eliteNow ? 0.35 : stageFor(level).gap);
    let cancelled = false;
    let gapTimer: ReturnType<typeof setTimeout> | null = null;
    const burstTimers: ReturnType<typeof setTimeout>[] = [];
    // Burst schedule from estimated audio length (fallback 3s).
    const estLen = Math.max(1.5, Math.min(6, (s.getDuration() || 3) / Math.max(0.5, speed)));
    const runId = runIdRef.current;
    const cmdSeq = ++cmdSeqRef.current; // race guard: bursts belong to THIS command
    const stillHere = () => !cancelled && runIdRef.current === runId && phaseRef.current === 'playing';
    const grabBurst = async () => {
      const takenAt = Date.now();
      try {
        const snap = await snapSmall();
        if (!stillHere() || !snap) return;
        samBytesRef.current += snap.bytes;
        samCallsRef.current += 1;
        const { text } = await segmentPerson(snap.b64);
        const boxes = parseSamBoxes(text);
        const ref = prevBoxRef.current ?? restBox;
        const box = pickBox(boxes, ref);
        // Sequence-TAGGED write (Wonder fix #2): entry carries cmdSeq +
        // timestamp; scoring filters to this command only.
        if (box && stillHere()) burstRef.current.push({ box, seq: cmdSeq, t: takenAt });
      } catch { /* burst miss — gap snapshot covers it */ }
    };
    burstTimers.push(setTimeout(grabBurst, estLen * 400));
    burstTimers.push(setTimeout(grabBurst, estLen * 800));
    s.play(() => {
      if (cancelled || runIdRef.current !== runId) return;
      gapTimer = setTimeout(async () => {
        if (!stillHere()) return;
        // Sampling gate (Wonder): training-length stages skip most SAM calls.
        // Skipped commands pass on the honor tick (logged as sampled).
        const cmdIndex = tries;
        if (!isKids && !shouldSample(cmdIndex)) {
          setVerdict(`⏩ sampled pass (${j0cmd()})`);
          setScore(sc => sc + 1);
          setTries(t => t + 1);
          setKcal(k => k + kcalFor(commandId));
          advance();
          return;
        }
        // Prefer max-delta burst frame; fallback to a fresh gap snapshot.
        // Filter to THIS command's sequence (Wonder fix #2).
        let frames = burstRef.current.filter(e => e.seq === cmdSeq).map(e => e.box);
        const frameTimes = burstRef.current.filter(e => e.seq === cmdSeq).map(e => e.t);
        burstRef.current = burstRef.current.filter(e => e.seq !== cmdSeq);
        if (frames.length === 0) {
          try {
            const snap = await snapSmall();
            if (snap && stillHere()) {
              samBytesRef.current += snap.bytes;
              samCallsRef.current += 1;
              const { text } = await segmentPerson(snap.b64);
              const box = pickBox(parseSamBoxes(text), prevBoxRef.current ?? restBox);
              if (box) {
                frames = [box];
                frameTimes.push(Date.now());
              }
            }
          } catch { /* handled as UNVERIFIED below */ }
        }
        if (!stillHere()) return;
        const base = prevBoxRef.current ?? restBox;
        // Immediate UNVERIFIED pause (Wonder fix): the FIRST unverified
        // check pauses with tap-to-resume — no silent stalls, no 3-count.
        // markUnverified with autoRetry=true re-arms the SAME command after
        // a short beat so brief hiccups self-heal without a tap.
        const markUnverified = (why: string, autoRetry = true) => {
          if (isKids) {
            setVerdict('SAM hiccup — star kept ⭐');
            setScore(sc => sc + 1);
            setKcal(k => k + kcalFor(commandId));
            setTries(t => t + 1);
            advance();
            return;
          }
          // UNVERIFIED countdown: ref-tracked streak (state lags one render
          // behind inside this async closure — the ref is exact).
          // Pause helper is the single decider — no silent stalls.
          unverifiedRef.current += 1;
          const n = unverifiedRef.current;
          setUnverified(n);
          if (shouldPauseOnUnverified(n)) {
            setPaused(true);
            setSamStatus('unavailable');
            setVerdict(`⏸️ ${why} — tap resume to retry`);
            if (autoRetry && stillHere()) {
              autoRetryTimerRef.current = setTimeout(() => {
                if (stillHere() && pausedRef.current) resumePaused();
              }, 2500);
            }
          } else {
            setVerdict(`⏸️ ${why} (${n}/1)…`);
            advance();
          }
        };
        if (!(await loadSamKey())) {
          markUnverified('Add your SAM key in Settings');
          return;
        }
        if (frames.length === 0 || !base) {
          markUnverified(!base ? 'no baseline yet — hold still' : 'no silhouette — hold still');
          return;
        }
        // Score every burst frame vs the previous verified frame; take the
        // strongest evidence (max grow/shift). Jerk from burst CENTROID
        // TRAJECTORY with REAL dt (Wonder fix #5): needs >=2 frames (2-point
        // velocity fallback), no more hardcoded 0.4s or unreachable >=3 gate.
        const traj = frames.map(f => {
          const w = f.w || 1;
          const h = f.h || 1;
          return { x: (f.x1 + f.x2) / 2 / w, y: (f.y1 + f.y2) / 2 / h };
        });
        const { scoreJerk: sj } = await import('../sam/verifier');
        let jerkScore: number | null = null;
        if (traj.length >= 2) {
          const spanS = frameTimes.length >= 2
            ? Math.max(0.2, ((frameTimes[frameTimes.length - 1] - frameTimes[0]) / 1000) / Math.max(1, frameTimes.length - 1))
            : 0.4;
          jerkScore = sj(traj, spanS).jerk;
        }
        // Per-frame SIGN detection: every frame gets a signature verdict
        // (did THIS frame show the commanded sign?). Streak wins — a frame
        // passes when its sign is in the command's sign set. Judges see the
        // live border flash per frame, not a single end-of-command guess.
        const want = signsForCommand(commandId);
        const frameSigns = frames.map(f => signBetween(base, f));
        const bestSign = frameSigns.reduce((a, b) => (b.confidence > (a?.confidence ?? -1) ? b : a), null as SignMatch | null);
        const signOk = expected === 'freeze'
          ? frameSigns.every(sm => sm.kind === 'STILL')
          : frameSigns.some(sm => want.includes(sm.kind) || sm.kind === 'UNKNOWN');
        if (!isKids && frames[0]) {
          // Judges: live border follows the strongest frame too.
          const bestIdx = frameSigns.indexOf(bestSign as SignMatch);
          if (bestIdx >= 0 && frames[bestIdx]) setLiveBox(frames[bestIdx]);
        }
        // Personal thresholds (Wonder): calibScale from the saved profile
        // shrinks thresholds for subtle movers, 1.0 when no profile.
        // Video-strip evidence (Wonder): 4-frame centroid path + hold score
        // back the burst verdict — long smooth travel = real move, flat
        // hold = freeze. Grid-profile delta is the honest tiebreaker.
        const videoPath = centroidPath(frames);
        const videoLen = pathLength(videoPath);
        const videoHold = holdScore(videoPath);
        const gridDelta = frames.length >= 2
          ? profileDelta(gridFromBox(frames[0]), gridFromBox(frames[frames.length - 1]))
          : null;
        const gridMove = gridDelta ? Math.hypot(gridDelta.dCX, gridDelta.dCY) + Math.abs(gridDelta.dTop) + Math.abs(gridDelta.dBottom) : 0;
        const videoSupportsMove = videoLen >= 0.03 * calibScale || gridMove >= 0.08 * calibScale;
        const videoSupportsHold = videoHold >= 0.75 && videoLen < 0.05 * calibScale;
        const jBase = judgeMove(commandId, expected, base, frames[frames.length - 1], isKids, jerkScore, calibScale);
        // Combine: box-delta verdict AND sign evidence must agree on adults.
        // Video strip breaks ties honestly: a PASS with a flat hold track
        // on a move command = UNVERIFIED retry, never a free pass or loss.
        const jPre = !isKids && expected === 'move' && !signOk && jBase.kind === 'PASS' && !videoSupportsMove
          ? { ...jBase, kind: 'UNVERIFIED' as const, unverifiedStreak: 1, reason: `unclear move (saw ${bestSign?.kind ?? 'none'} — wanted ${want.join('/')}; hold ${Math.round(videoHold * 100)}%) — retry` }
          : !isKids && expected === 'move' && !signOk && jBase.kind === 'PASS'
          ? { ...jBase, kind: 'FAIL_MOVE' as const, reason: `wrong sign (saw ${bestSign?.kind ?? 'none'} — wanted ${want.join('/')})` }
          : jBase;
        // Pose-library template judging (handoff §8): personalised evidence.
        // Keeps every existing check; adds matchScore vs the player's stored
        // pose for this command. Markers are SAM zone marks (never joints).
        let j = jPre;
        let templatePct: number | null = null;
        const liveFrame = frames[frames.length - 1];
        if (!isKids && judgingMode === 'library' && poseLib && liveFrame && base) {
          try {
            const { matchScore: matchFn, neutralMatch: neutralMatchFn } = await import('../sam/poseLibrary');
            const tpl = (poseLib.templates as Record<string, import('../sam/poseLibrary').PoseTemplate>)[commandId];
            const neutralBox = poseLib.neutralBox;
            const passBar = poseLib.passThreshold ?? 0.72;
            if (tpl) {
              const m = matchFn(liveFrame, poseLib.neutralBox, prevBoxRef.current, tpl);
              templatePct = Math.round(m.total * 100);
              const neutralM = neutralMatchFn(liveFrame, neutralBox);
              if (expected === 'freeze') {
                // Trap: hold must match NEUTRAL, not the named pose.
                if (!(neutralM >= 0.75 && m.total < 0.6) && j.kind !== 'FAIL_MOVE') {
                  j = { ...j, kind: 'UNVERIFIED' as const, unverifiedStreak: 1, reason: `trap unclear (match ${templatePct}% vs your stored ${commandId.replace(/_/g, ' ')}) — retry` };
                }
              } else if (m.total < passBar - 0.17 && j.kind === 'PASS' && (m.total < 0.55)) {
                j = { ...j, kind: 'FAIL_MOVE' as const, reason: `wrong pose (match ${templatePct}% vs your stored ${commandId.replace(/_/g, ' ')})` };
              } else if (m.total >= passBar - 0.17 && m.total < passBar && j.kind === 'PASS') {
                j = { ...j, kind: 'UNVERIFIED' as const, unverifiedStreak: 1, reason: `close (match ${templatePct}% vs your stored ${commandId.replace(/_/g, ' ')}) — retry` };
              }
            }
          } catch { /* template layer is advisory — never crashes judging */ }
        } else if (isKids && judgingMode === 'library' && poseLib && liveFrame) {
          try {
            const { matchScore: matchFn } = await import('../sam/poseLibrary');
            const tpl = (poseLib.templates as Record<string, import('../sam/poseLibrary').PoseTemplate>)[commandId];
            if (tpl) {
              const m = matchFn(liveFrame, poseLib.neutralBox, prevBoxRef.current, tpl);
              templatePct = Math.round(m.total * 100);
            }
          } catch { /* ignore */ }
        }
        if (frames.length > 0 && j.kind === 'PASS') {
          prevBoxRef.current = frames[frames.length - 1];
        }
        if (frames.length > 0) {
          setLiveBox(frames[frames.length - 1]);
          setLiveSign(bestSign);
        }
              // Kids: forgiving thresholds never fail; 3 tries per OCCURRENCE
              // (Wonder: kidTriesRef was keyed by command id across the run).
              kidTriesRef.current.n += 1;
              const attempt = kidTriesRef.current.n;
              const need = isKids ? 3 : 1;
              const pass = j.kind === 'PASS';
              const kidPass = isKids && (pass || attempt >= need);
              setUnverified(0); // proven verdict resets both counters
              unverifiedRef.current = 0;
              if (templatePct != null) setMatchPct(templatePct);
              else setMatchPct(null); // Wonder: stale match must clear
              const modeTag = judgingMode === 'library' && templatePct != null ? ` · match ${templatePct}% vs your stored ${commandId.replace(/_/g, ' ')}` : '';
              // Project today's stored marker for THIS command only (Wonder:
              // stale markers on other commands mislead). No marker = none.
              try {
                const tplNow = judgingMode === 'library' && poseLib ? (poseLib.templates as Record<string, import('../sam/poseLibrary').PoseTemplate>)[commandId] : null;
                setPoseMark(tplNow?.marker ? { x: tplNow.marker.x, y: tplNow.marker.y, zone: String(tplNow.marker.zone) } : null);
              } catch {
                setPoseMark(null);
              }
              const kidExtra = isKids && templatePct != null && templatePct >= 40 && templatePct < 55 ? ` So close! Try a bigger ⭐ move (${templatePct}% vs your stored move)` : isKids && templatePct != null ? ` (${templatePct}% match)` : '';
              setVerdict(pass ? `✅ ${isKids ? 'Great job!' : 'moved'} (${j.reason})${modeTag}${kidExtra}` : `❌ ${isKids ? `try again! (${attempt}/${need})` : 'wrong move'} (${j.reason})${modeTag}${kidExtra}`);
              setTries(t => t + 1);
              if (pass || kidPass) {
                setScore(sc => sc + 1);
                setHits(h => h + 1);
                setStreak(s => s + 1);
                setKcal(k => k + kcalFor(commandId));
              } else if (!isKids) {
                // Terminal: OUT now — do NOT fall through to next-command
                // draw or playKey re-arm (Wonder: stale callback restarted
                // audio/state on a finished run).
                registerMiss(j.reason);
                return;
              }
              if (isKids) burstRef.current = [];
              if (isKids) {
                setAdaptSpeed(a => {
                  const target = Math.min(1.5, Math.max(0.7, 0.7 + hitRate * 0.8));
                  return a + (target - a) * 0.3;
                });
              }
              // Spark advisory (stats-only, every 4th proven verdict): never
              // blocks scoring — fallback text when offline/keyless.
              // Run-guarded (Wonder P1): a slow reply after retry/OUT is
              // dropped via runId so it can't pollute the next run's tip.
              // Kids: local templated tip, no network at all.
              // Snapshot is POST-verdict (tries+1, hits+pass) — no one-render lag.
              if (isKids) {
                const { kidsTip } = await import('../intelligence/museSpark');
                if (!stillHere()) return;
                setSparkTip(kidsTip(tries + 1));
                setSparkLive(false);
              } else if ((tries + 1) % 4 === 0) {
                const myRun = runIdRef.current;
                const done = pass || kidPass;
                adviseNextStage({ mode: gameMode, stage: level, speed, score: score + (done ? 1 : 0), hits: hits + (done ? 1 : 0), tries: tries + 1, streak: streak + (done ? 1 : 0), recentFailReason: j.reason, unverifiedCount: unverified })
                  .then(a => {
                    if (runIdRef.current !== myRun || !stillHere()) return;
                    setSparkTip(a.feedback);
                    setSparkLive(a.live);
                    setSparkSource(a.source);
                    setSparkAt(a.at || Date.now());
                    sparkLatencyRef.current = a.latencyMs || 0;
                    setSparkLatency(a.latencyMs || 0);
                    if (a.recalibrate) setRecalibrate(true);
                    // Stage-bounded advice (Wonder P1): applied ONLY at the
                    // timer stage boundary via sparkStageDelta/sparkTrickNudge.
                    // Clamp: ±1 stage, trick nudge ±0.1 — never jumps the ramp.
                    setSparkStageDelta(a.nextStageDelta);
                    setSparkTrickNudge(a.trickRate == null ? 0 : Math.max(-0.1, Math.min(0.1, a.trickRate - trickRate)));
                  })
                  .catch(() => {});
              }
        // Stale-branch retired: old `else` awarded points with no SAM check.
        // Old try/catch also folded network faults into losses; now only
        // proven FAIL_MOVE (registerMiss above) ends the run.
        function j0cmd() { return commandId.replace(/_/g, ' '); }
        function advance() {
          const p = poolFor(voice, gameMode);
          const next = drawCommand(p, recent);
          pushRecent(next);
          setCommandId(next);
          setSimonSaysIt(isKids ? true : Math.random() < effTrickRate());
          setPlayKey(k => k + 1);
        }
        advance();
      }, gap * 1000);
    });
    return () => {
      cancelled = true;
      if (gapTimer) clearTimeout(gapTimer);
      for (const t of burstTimers) clearTimeout(t);
      try { s.stop(); } catch { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, playKey]);

  // Log the finished run once for the progress graph (REAL seconds survived).
  // Endless: logs only on sudden-death OUT (failed run end). Spark
  // end-of-run summary is stats-only (no images) with a local fallback.
  // One call only (Wonder P1-minor): reuses the last advisory when fresh
  // instead of paying a second full model call for one feedback string.
  useEffect(() => {
    if (phase !== 'done' || over_logged) return;
    setOverLogged(true);
    logSession(score, kcal, Math.min(elapsedRef.current, duration * Math.max(1, Math.min(level, 999))));
    const myRun = runIdRef.current;
    if (sparkTip) {
      setSparkNote(sparkTip);
      setSparkNoteLive(sparkLive);
      return;
    }
    endOfRunSummary({ mode: gameMode, stage: level, speed, score, hits, tries, streak, recentFailReason: loseReason || null, unverifiedCount: unverified })
      .then(r => {
        if (runIdRef.current !== myRun) return; // stale summary dropped
        setSparkNote(r.text);
        setSparkNoteLive(r.live);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const retryLevel = () => {
    setFailed(false);
    setPaused(false);
    setUnverified(0);
    unverifiedRef.current = 0;
    unverifiedRef.current = 0;
    setOverLogged(false);
    setSparkTip('');
    setSparkLive(false);
    setSparkSource('local');
    setSparkAt(0);
    setSparkNote('');
    setSparkNoteLive(false);
    setSparkStageDelta(0);
    setSparkTrickNudge(0);
    runIdRef.current += 1; // invalidate stale async callbacks (Wonder)
    elapsedRef.current = 0;
    samCallsRef.current = 0;
    samBytesRef.current = 0;
    burstRef.current = [];
    cmdSeqRef.current += 1;
    setTimeLeft(duration);
    prevBoxRef.current = null;
    kidTriesRef.current = { n: 0 };
    baseSamplesRef.current = [];
    calibSamplesRef.current = [];
    setCalibIdx(0);
    setCalibMsg('');
    setCalibZones({});
    setCalibSkipped(false);
    setRecalibrate(false);
    setPoseLib(null);
    setEnrollIdx(0);
    setEnrollMsg('');
    setEnrollMissing([]);
    setEnrollmentWaived(false);
    setPoseMark(null);
    setMatchPct(null);
    setJudgingMode('default');
    const p = poolFor(voice, gameMode);
    const next = drawCommand(p, recent);
    pushRecent(next);
    setCommandId(next);
    setSimonSaysIt(isKids ? true : Math.random() < effTrickRate());
    setPhase('getready');
    setCount(10);
    setGatePhase('mapping');
    setMapOk(false);
    setMapMsg('');
    setRestBox(null);
    setSamStatus('idle');
    setPlayKey(k => k + 1);
  };

  // Resume from UNVERIFIED pause: re-runs the CURRENT command —
  // no advance, no penalty, same speed. Clears stale burst frames so the
  // retry samples fresh. Only proven FAIL_MOVE ends the run.
  const resumePaused = () => {
    runIdRef.current += 1;
    setPaused(false);
    setUnverified(0);
    unverifiedRef.current = 0;
    burstRef.current = [];
    cmdSeqRef.current += 1;
    setSamStatus('scanning');
    setVerdict('▶️ resuming — hold still…');
    setPlayKey(k => k + 1);
  };

  const nextLevel = () => {
    setOverLogged(false);
    setFailed(false);
    setSparkTip('');
    setSparkLive(false);
    setSparkSource('local');
    setSparkAt(0);
    setSparkNote('');
    setSparkNoteLive(false);
    setSparkStageDelta(0);
    setSparkTrickNudge(0);
    prevBoxRef.current = null;
    kidTriesRef.current = { n: 0 };
    baseSamplesRef.current = [];
    calibSamplesRef.current = [];
    setCalibIdx(0);
    setCalibMsg('');
    setCalibZones({});
    setCalibSkipped(false);
    setRecalibrate(false);
    const p = poolFor(voice, gameMode);
    const next = drawCommand(p, recent);
    pushRecent(next);
    setCommandId(next);
    setSimonSaysIt(isKids ? true : Math.random() < effTrickRate());
    setPhase('getready');
    setCount(10);
    setGatePhase('mapping');
    setMapOk(false);
    setMapMsg('');
    setRestBox(null);
    setSamStatus('idle');
    setPlayKey(k => k + 1);
  };

  // Framing hint shown during countdown so the player positions themselves.
  // Bootcamp: prop the phone — floor moves need distance.
  // Kids: cheerful half-body prompt + current adaptive pace.
  const frameHint =
    gameMode === 'kids'
      ? `🧒 Show your smiley face + shoulders! · pace ${speed.toFixed(2)}x`
      : gameMode === 'bootcamp'
        ? '📱 Prop phone back — FULL body + floor in frame'
        : fullBody
          ? '📏 Step back — show your FULL body'
          : '🪞 Half body — face + shoulders in frame';

  return (
    <View style={styles.easyContainer}>
      {device != null && hasPermission ? (
        <Camera
          ref={cameraRef}
          style={styles.easyCamera}
          device={device}
          isActive={true}
          photo={true}
          video={false}
          audio={false}
          zoom={fullBody ? 0.6 : 1.4}
        />
      ) : (
        <View style={[styles.easyCamera, styles.easyNoCam]}>
          <Text style={styles.easyNoCamText}>
            {!device ? 'No front camera found on this device' : !hasPermission ? 'Camera blocked — tap to allow' : 'Requesting camera…'}
          </Text>
          {!device || hasPermission ? null : (
            <TouchableOpacity style={styles.camAllowBtn} onPress={() => requestPermission().catch(() => {})} activeOpacity={0.8}>
              <Text style={styles.camAllowText}>📷 Allow camera</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Slim top strip: mode · timer — one line, out of the face zone.
          Command sits directly under it; kcal lives in the corner chip. */}
      {phase === 'playing' ? (
        <View style={styles.topStrip} pointerEvents="none">
          <Text style={styles.topStripText}>
            {mode} · ⏱ {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}
          </Text>
          <View style={styles.timerBar}>
            <View style={[styles.timerFill, { width: `${duration > 0 ? (timeLeft / duration) * 100 : 0}%` }]} />
          </View>
          <View style={styles.cmdPill}>
            <Text style={styles.cmdText} numberOfLines={2}>{stageFlash ? `⚡ STAGE ${Math.min(level, MAX_STAGE)}/10 · ${speed.toFixed(2)}x` : commandLabel}</Text>
          </View>
        </View>
      ) : (
        <View style={styles.modeBadgeWrap} pointerEvents="none">
          <View style={styles.modeBadgePill}>
            <Text style={styles.modeBadgeText}>{mode}</Text>
          </View>
        </View>
      )}
      {phase === 'getready' && gatePhase === 'mapping' ? (
        <View style={styles.countdownWrap}>
          <View style={styles.mapCard}>
            <Text style={styles.mapTitle}>📷 GET INTO FRAME</Text>
            <Text style={styles.mapNeed}>{frameNeed.label}</Text>
            <Text style={styles.mapStatus}>{mapOk ? `✅ ${mapMsg}` : mapMsg || '🔍 SAM mapping your profile…'}</Text>
            <Text style={styles.mapHint}>Upper body for Easy · full body for Hard · full body + floor for Bootcamp</Text>
          </View>
        </View>
      ) : null}
      {/* Guided calibrating card: step x/y, instruction, SAM mark state,
          zone chip, skip. Persists a personal profile that scales play. */}
      {phase === 'getready' && gatePhase === 'calibrating' ? (
        <View style={styles.countdownWrap}>
          <View style={styles.mapCard}>
            <Text style={styles.mapTitle}>🧭 BODY SETUP {calibIdx + 1}/{calibSteps.length}</Text>
            <Text style={styles.mapNeed}>{calibSteps[calibIdx]?.instruction ?? ''}</Text>
            <Text style={styles.mapStatus}>{calibMsg || 'SAM marking your pose…'}</Text>
            {recalibrate ? <Text style={styles.mapHint}>💡 Coach suggests a fresh setup — finish or skip below</Text> : null}
            <TouchableOpacity style={styles.durChip} onPress={skipCalibration} activeOpacity={0.8}>
              <Text style={styles.durText}>⏩ Skip setup (default sensitivity)</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
      {/* Pose-library enrollment card (handoff §3): per-pose progress, SAM
          zone marker (never a joint), stored confirmation, skip path. */}
      {phase === 'getready' && gatePhase === 'enrolling' ? (
        <View style={styles.countdownWrap}>
          <View style={styles.mapCard}>
            {enrollIdx < 0 ? (
              <>
                <Text style={styles.mapTitle}>📚 POSE LIBRARY CHECK</Text>
                <Text style={styles.mapNeed}>Welcome back — pose library still fits?</Text>
                <Text style={styles.mapStatus}>Stored poses found for this mode. Repeat 2 quick poses to re-check, or redo the full library.</Text>
                <TouchableOpacity style={styles.durChip} onPress={() => { setEnrollIdx(0); enrollBoxesRef.current = null; }} activeOpacity={0.8}>
                  <Text style={styles.durText}>✅ Re-check poses</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.durChip} onPress={skipEnrollment} activeOpacity={0.8}>
                  <Text style={styles.durText}>⏩ Skip pose library (default judging)</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.mapTitle}>📚 POSE LIBRARY {Math.min(enrollIdx + 1, enrollTotal)}/{enrollTotal}</Text>
                <Text style={styles.mapNeed}>{enrollPool[enrollIdx]?.replace(/_/g, ' ') ?? 'do this pose, SAM will remember it'}</Text>
                <Text style={styles.mapStatus}>{enrollMsg || 'Get ready…'}</Text>
                {poseMark ? <Text style={styles.mapHint}>● SAM marked your {poseMark.zone} zone</Text> : null}
                {enrollMissing.length > 0 ? <Text style={styles.mapHint}>⏭️ {enrollMissing.length} pose(s) skipped this run</Text> : null}
                <TouchableOpacity style={styles.durChip} onPress={skipEnrollment} activeOpacity={0.8}>
                  <Text style={styles.durText}>⏩ Skip pose library (default judging)</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      ) : null}
      {phase === 'getready' && gatePhase === 'countdown' ? (
        <View style={styles.countdownWrap}>
          <View style={styles.countdownBubble}>
            <Text key={count} style={styles.countdownText}>{count}</Text>
          </View>
          <View style={[styles.samPill, samStatus === 'locked' ? styles.samLocked : samStatus === 'scanning' ? styles.samScanning : styles.samIdle]}>
            <Text style={styles.samText}>
              {samStatus === 'locked' ? '✅ body outlined — hold still!' : samStatus === 'scanning' ? `🔍 SAM outlining your body… (${10 - count}s)` : samStatus === 'unavailable' ? '⏸️ paused — check key/signal, tap retry' : `📷 get into frame — ${count}s`}
            </Text>
          </View>
          <View style={styles.frameHintPill}>
            <Text style={styles.frameHintText}>{frameHint} · Stage {Math.min(level, MAX_STAGE)}/10 · {speed.toFixed(2)}x{stayHere ? ' · 🔁 staying' : ''}</Text>
          </View>
          <View style={styles.durRow}>
            {DURATIONS.map(d => (
              <TouchableOpacity key={d} style={[styles.durChip, duration === d && styles.durChipOn]} onPress={() => setDuration(d)} activeOpacity={0.8}>
                <Text style={[styles.durText, duration === d && styles.durTextOn]}>{fmtDur(d)}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {gameMode === 'bootcamp' ? (
            <Text style={styles.durHint}>🏋️ Training mode — pick your round length</Text>
          ) : null}
        </View>
      ) : phase === 'playing' ? null : null}

      {/* Live SAM outline for judges: green tracking border + signature tag.
          Box coords are image pixels normalized to % of the selfie view.
          Calibrating zone marks render as cyan boxes over the selfie. */}
      {liveBox && (phase === 'playing' || gatePhase !== 'mapping') ? (
        <View pointerEvents="none" style={styles.samBoxWrap}>
          <View
            style={[
              styles.samBox,
              {
                left: `${(liveBox.x1 / Math.max(1, liveBox.w)) * 100}%` as any,
                top: `${(liveBox.y1 / Math.max(1, liveBox.h)) * 100}%` as any,
                width: `${((liveBox.x2 - liveBox.x1) / Math.max(1, liveBox.w)) * 100}%` as any,
                height: `${((liveBox.y2 - liveBox.y1) / Math.max(1, liveBox.h)) * 100}%` as any,
                borderColor: liveSign?.kind === 'STILL' ? '#94a3b8' : '#6BCB77',
              },
            ]}
          >
            <Text style={styles.samBoxText}>
              SAM · {signatureOf(liveBox).area ? `${Math.round(signatureOf(liveBox).area * 100)}%` : ''}
              {liveSign ? ` · ${liveSign.kind}` : ''}
            </Text>
          </View>
          {phase === 'getready' && gatePhase === 'calibrating'
            ? Object.entries(calibZones).map(([name, z]) => (
              <View
                key={name}
                style={[
                  styles.samBox,
                  styles.calibZone,
                  {
                    left: `${(z?.x ?? 0) * 100}%`as any,
                    top: `${(z?.y ?? 0) * 100}%` as any,
                    width: `${Math.max(2, (z?.w ?? 0) * 100)}%` as any,
                    height: `${Math.max(2, (z?.h ?? 0) * 100)}%` as any,
                  },
                ]}
              >
                <Text style={styles.calibZoneText}>{name}</Text>
              </View>
            ))
            : null}
          {/* SAM zone marker (handoff §1, §3.4, §8): cyan dot + zone label.
              Honest: a SAM change-region/zone mark — never a joint. */}
          {poseMark && (phase === 'getready' || phase === 'playing') ? (
            <View
              pointerEvents="none"
              style={[
                styles.poseMark,
                {
                  left: `${Math.min(96, Math.max(0, poseMark.x * 100 - 2))}%` as any,
                  top: `${Math.min(96, Math.max(0, poseMark.y * 100 - 2))}%` as any,
                },
              ]}
            >
              <Text style={styles.poseMarkText}>● {poseMark.zone}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Corner kcal chip (top-right) + tiny verdict under it — all modes.
          Personal scale + Spark tip sit under the verdict line. */}
      {phase === 'playing' ? (
        <View style={styles.cornerWrap} pointerEvents="none">
          <View style={styles.cornerCal}>
            <Text style={styles.cornerCalText}>🔥 {kcal.toFixed(1)}</Text>
          </View>
          {profile ? (
            <View style={styles.cornerScale}>
              <Text style={styles.cornerScaleText}>🎯 {Math.round(calibScale * 100)}%</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* UNVERIFIED pause overlay (Wonder): network/key/reading faults pause
          with tap-to-resume — never a loss. Only proven FAIL_MOVE ends runs. */}
      {phase === 'playing' && paused ? (
        <View style={styles.pauseWrap}>
          <View style={styles.pauseCard}>
            <Text style={styles.pauseTitle}>⏸️ PAUSED</Text>
            <Text style={styles.pauseSub}>{verdict}</Text>
            <TouchableOpacity style={styles.nextBtn} onPress={resumePaused} activeOpacity={0.8}>
              <Text style={styles.nextText}>▶️ Resume — retry this move</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {/* Sudden-death YOU LOSE screen — proven FAIL_MOVE only.}
      {phase === 'done' ? (
        <View style={styles.loseWrap}>
          <View style={styles.loseCard}>
            <Text style={styles.loseEmoji}>💀</Text>
            <Text style={styles.loseTitle}>YOU LOSE</Text>
            <Text style={styles.loseReason}>{loseReason || 'sudden death'}</Text>
            <Text style={styles.loseStats}>Stage {Math.min(level, MAX_STAGE)}/10 · {score} moves · 🔥 {kcal.toFixed(1)} kcal</Text>
            <Text style={styles.loseCost}>📡 {samCallsRef.current} SAM calls · {(samBytesRef.current / 1024).toFixed(0)} KB up · ✨ Spark: {sparkNoteLive || sparkLive ? `live 1.3 · ${sparkLatency}ms` : sparkSource === 'no-key' ? 'no key' : sparkSource === 'timeout' ? 'timeout' : sparkSource === 'http' ? 'offline' : sparkSource === 'parse' ? 'parse' : 'local'}{sparkAt ? ` · ${new Date(sparkAt).toLocaleTimeString()}` : ''}</Text>
            {recalibrate ? (
              <TouchableOpacity style={styles.recalBtn} onPress={() => { setOverLogged(false); setPhase('getready'); setCount(10); setPoseLib(null); setJudgingMode('default'); setEnrollIdx(0); setGatePhase('enrolling'); }} activeOpacity={0.8}>
                <Text style={styles.recalText}>🧭 Coach says re-setup — redo body setup</Text>
              </TouchableOpacity>
            ) : null}
            <View style={styles.loseRules}>
              <Text style={styles.loseRulesTitle}>HOW TO STAY ALIVE</Text>
              <Text style={styles.loseRule}>✅ Move on “Simon says…” — fast + smooth</Text>
              <Text style={styles.loseRule}>🛑 Freeze on bare commands (no prefix = trap)</Text>
              <Text style={styles.loseRule}>📷 Stay in frame — no reading = out</Text>
              <Text style={styles.loseRule}>🌊 Flailing fails even when big</Text>
            </View>
          </View>
        </View>
      ) : null}

      {/* Bottom sheet: score line + verdict + actions — stats only, no kcal pill.
          Spark tip (advisory, fallback-safe) + profile scale shown inline. */}
      <View style={styles.easyOverlay}>
        <View style={styles.hudRow} pointerEvents="none">
          <View style={styles.hudPill}>
            <Text style={styles.hudText}>St {Math.min(level, MAX_STAGE)}/10 · {speed.toFixed(2)}x · {score} moves{isKids ? ` · 😊 ${Math.round(hitRate * 100)}%` : elite ? ` · ⚡ELITE x${streak}` : ''}{stayHere ? ' · 🔁' : ''} · {judgingMode === 'library' ? '📚 Pose library ON' : '🎯 Default judging'}</Text>
          </View>
        </View>
        {phase === 'playing' ? (
          <View style={styles.verdictLine} pointerEvents="none">
            <Text style={styles.verdictInline} numberOfLines={1}>{verdict}</Text>
            {sparkTip ? <Text style={styles.sparkInline} numberOfLines={2}>💡 {sparkTip}{sparkLive ? ` · live 1.3 · ${sparkLatency}ms` : sparkSource === 'no-key' ? ' · no key' : sparkSource === 'timeout' ? ' · timeout' : sparkSource === 'http' ? ' · (offline tip)' : sparkSource === 'parse' ? ' · parse' : ' · (offline tip)'}</Text> : null}
          </View>
        ) : null}
        {phase === 'done' ? (
          <TouchableOpacity style={styles.nextBtn} onPress={retryLevel} activeOpacity={0.8}>
            <Text style={styles.nextText}>🔁 Retry stage {Math.min(level, MAX_STAGE)} ▶</Text>
          </TouchableOpacity>
        ) : null}
        {phase === 'done' && sparkNote ? (
          <View style={styles.verdictLine} pointerEvents="none">
            <Text style={styles.sparkInline} numberOfLines={2}>💡 {sparkNote}{sparkNoteLive ? '' : ' · (offline tip)'}</Text>
          </View>
        ) : null}
        <TouchableOpacity style={styles.backBtn} onPress={onBack} activeOpacity={0.8}>
          <Text style={styles.backText}>← Back to Home</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function VsPicker({ onPick, onBack }: { onPick: (voice: Voice) => void; onBack: () => void }) {
  return (
    <View style={styles.container}>
      <View style={styles.blob1} />
      <View style={styles.blob2} />
      <View style={styles.blob3} />
      <Text style={styles.modeBadge}>⚔️ VS MODE</Text>
      <Text style={styles.title}>CHALLENGER PICKS</Text>
      <Text style={styles.subtitle}>Challenge in Easy (👩 female) or Hard (👨 male)?</Text>
      <View style={styles.vsRow}>
        <TouchableOpacity style={[styles.backBtn, styles.vsPick]} onPress={() => onPick('female')} activeOpacity={0.85}>
          <Text style={styles.backText}>👩 Easy voice</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.backBtn, styles.vsPick]} onPress={() => onPick('male')} activeOpacity={0.85}>
          <Text style={styles.backText}>👨 Hard voice</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity style={styles.backBtn} onPress={onBack} activeOpacity={0.8}>
        <Text style={styles.backText}>← Back to Home</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function GameScreen() {
  const navigation = useNavigation();
  const route = useRoute<any>();
  const mode = route.params?.mode ?? 'easy';
  const [vsVoice, setVsVoice] = useState<Voice | null>(null);
  // Voice mapping: easy → female, hard → male.
  // VS: challenger picks easy (female) or hard (male).
  const voice: Voice = mode === 'easy' ? 'female' : mode === 'hard' ? 'male' : vsVoice ?? 'female';
  if (mode === 'vs' && vsVoice == null) {
    return <VsPicker onPick={setVsVoice} onBack={() => navigation.goBack()} />;
  }
  const isBoot = mode === 'bootcamp';
  const isKidsMode = mode === 'kids';
  const voice2: Voice = isBoot || isKidsMode ? (isKidsMode ? 'female' : 'male') : voice;
  const badge = isKidsMode
    ? '🧒 KIDS MODE · 👩'
    : isBoot
      ? '🪖 BOOTCAMP · 👨'
      : mode === 'easy' ? '🌱 EASY MODE · 👩' : mode === 'hard' ? '🔥 HARD MODE · 👨' : `⚔️ VS · ${voice === 'female' ? '👩 Easy' : '👨 Hard'}`;
  return (
    <>
      {/* Header badge overlay rendered inside PlayModeScreen via overlay below */}
      <PlayModeScreen mode={badge} voice={voice2} onBack={() => navigation.goBack()} />
    </>
  );
}

const styles = StyleSheet.create({
  easyContainer: { flex: 1, backgroundColor: '#000' },
  easyCamera: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' },
  easyNoCam: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f172a' },
  easyNoCamText: { color: '#94a3b8', fontWeight: '700', textAlign: 'center', paddingHorizontal: 24 },
  camAllowBtn: { marginTop: 14, backgroundColor: '#00D9FF', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 999 },
  camAllowText: { color: '#0f172a', fontWeight: '900', fontSize: 15 },
  pauseWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, backgroundColor: 'rgba(0,0,0,0.55)' },
  samBoxWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  samBox: { position: 'absolute', borderWidth: 3, borderRadius: 6, backgroundColor: 'transparent' },
  samBoxText: { position: 'absolute', top: -22, left: 0, backgroundColor: 'rgba(0,0,0,0.7)', color: '#6BCB77', fontSize: 11, fontWeight: '900', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  pauseCard: { width: '100%', backgroundColor: '#0f172a', borderRadius: 24, paddingHorizontal: 26, paddingVertical: 24, alignItems: 'center', borderWidth: 3, borderColor: '#00D9FF' },
  pauseTitle: { color: '#00D9FF', fontWeight: '900', fontSize: 32, letterSpacing: 3 },
  pauseSub: { color: '#e2e8f0', fontWeight: '700', fontSize: 14, textAlign: 'center', marginTop: 10, marginBottom: 16 },
  listenWrap: { position: 'absolute', top: 116, left: 0, right: 0, alignItems: 'center' },
  listenPill: { backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 22, paddingVertical: 10, borderRadius: 999, borderWidth: 2, borderColor: '#FFD93D' },
  listenText: { color: '#fff', fontWeight: '900', fontSize: 17 },
  jerkPill: { marginTop: 8, paddingHorizontal: 16, paddingVertical: 7, borderRadius: 999, borderWidth: 2 },
  jerkGood: { backgroundColor: 'rgba(107,203,119,0.85)', borderColor: '#fff' },
  jerkMid: { backgroundColor: 'rgba(255,159,28,0.85)', borderColor: '#fff' },
  jerkBad: { backgroundColor: 'rgba(255,46,99,0.9)', borderColor: '#fff' },
  jerkText: { color: '#fff', fontWeight: '900', fontSize: 13 },
  durRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 14, paddingHorizontal: 24 },
  durChip: { backgroundColor: 'rgba(0,0,0,0.6)', borderWidth: 2, borderColor: '#475569', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  durChipOn: { borderColor: '#FFD93D', backgroundColor: 'rgba(255,217,61,0.25)' },
  durText: { color: '#cbd5e1', fontWeight: '900', fontSize: 14 },
  durTextOn: { color: '#FFD93D' },
  durHint: { color: '#FFD93D', fontWeight: '800', fontSize: 13, marginTop: 10, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, overflow: 'hidden' },
  strikes: { color: '#FF2E63', fontWeight: '900', fontSize: 15, marginTop: 8, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 14, paddingVertical: 5, borderRadius: 999, overflow: 'hidden' },
  modeBadgeWrap: { position: 'absolute', top: 64, left: 0, right: 0, alignItems: 'center' },
  modeBadgePill: { backgroundColor: 'rgba(26,26,46,0.7)', paddingHorizontal: 18, paddingVertical: 8, borderRadius: 999, borderWidth: 2, borderColor: '#00D9FF' },
  modeBadgeText: { color: '#fff', fontWeight: '900', fontSize: 14, letterSpacing: 1 },
  easyOverlay: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', padding: 24, paddingBottom: 48 },
  hudRow: { alignItems: 'center', marginBottom: 12 },
  hudPill: { backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 18, paddingVertical: 8, borderRadius: 999, borderWidth: 2, borderColor: '#FFD93D' },
  hudText: { color: '#fff', fontWeight: '900', fontSize: 14 },
  verdictPill: { marginTop: 8, borderColor: '#00D9FF' },
  verdictText: { color: '#00D9FF', fontWeight: '800', fontSize: 13 },
  nextBtn: { backgroundColor: '#6BCB77', paddingHorizontal: 30, paddingVertical: 14, borderRadius: 999, elevation: 4, marginBottom: 10 },
  nextText: { color: '#fff', fontWeight: '900', fontSize: 16 },
  stayOn: { backgroundColor: '#00D9FF' },
  countdownWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  countdownBubble: { width: 140, height: 140, borderRadius: 70, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center', elevation: 8, borderWidth: 5, borderColor: '#FFD93D' },
  countdownText: { fontSize: 72, fontWeight: '900', color: '#FF2E63' },
  samPill: { marginTop: 12, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999, borderWidth: 2 },
  samIdle: { backgroundColor: 'rgba(0,0,0,0.6)', borderColor: '#94a3b8' },
  samScanning: { backgroundColor: 'rgba(0,217,255,0.25)', borderColor: '#00D9FF' },
  samLocked: { backgroundColor: 'rgba(107,203,119,0.85)', borderColor: '#fff' },
  samText: { color: '#fff', fontWeight: '900', fontSize: 15, textAlign: 'center' },
  mapCard: { backgroundColor: 'rgba(26,26,46,0.88)', borderRadius: 24, paddingHorizontal: 26, paddingVertical: 24, alignItems: 'center', borderWidth: 3, borderColor: '#00D9FF', maxWidth: 340 },
  mapTitle: { color: '#fff', fontWeight: '900', fontSize: 22, letterSpacing: 2 },
  mapNeed: { color: '#FFD93D', fontWeight: '900', fontSize: 16, marginTop: 8, textAlign: 'center' },
  mapStatus: { color: '#e2e8f0', fontWeight: '700', fontSize: 14, textAlign: 'center', marginTop: 10 },
  mapHint: { color: '#94a3b8', fontWeight: '600', fontSize: 12, textAlign: 'center', marginTop: 8 },
  playWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  topStrip: { position: 'absolute', top: 56, left: 12, right: 12, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
  topStripText: { color: '#fff', fontWeight: '900', fontSize: 13, textAlign: 'center' },
  cmdPill: { marginTop: 8, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1.5, borderColor: '#FFD93D' },
  cmdText: { color: '#fff', fontWeight: '900', fontSize: 15, textAlign: 'center' },
  cornerWrap: { position: 'absolute', top: 150, right: 10, alignItems: 'flex-end' },
  cornerCal: { backgroundColor: 'rgba(255,46,99,0.9)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 2, borderColor: '#fff', elevation: 4 },
  cornerCalText: { color: '#fff', fontWeight: '900', fontSize: 13 },
  cornerScale: { marginTop: 6, backgroundColor: 'rgba(0,217,255,0.9)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 2, borderColor: '#fff' },
  cornerScaleText: { color: '#0f172a', fontWeight: '900', fontSize: 11 },
  calibZone: { borderColor: '#00D9FF', borderStyle: 'dashed' as any },
  calibZoneText: { position: 'absolute', top: -20, left: 0, backgroundColor: 'rgba(0,217,255,0.9)', color: '#0f172a', fontSize: 10, fontWeight: '900', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  poseMark: { position: 'absolute', width: 18, height: 18, borderRadius: 9, backgroundColor: 'rgba(0,217,255,0.85)', borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  poseMarkText: { position: 'absolute', top: -20, left: -6, backgroundColor: 'rgba(0,217,255,0.9)', color: '#0f172a', fontSize: 10, fontWeight: '900', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  verdictLine: { alignItems: 'center', marginBottom: 8 },
  verdictInline: { color: '#9CA3AF', fontWeight: '700', fontSize: 12 },
  sparkInline: { color: '#FFD93D', fontWeight: '800', fontSize: 12, textAlign: 'center', marginTop: 4, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, overflow: 'hidden' },
  liveCalPill: { backgroundColor: 'rgba(255,46,99,0.85)', paddingHorizontal: 26, paddingVertical: 10, borderRadius: 999, marginBottom: 10, borderWidth: 3, borderColor: '#fff', elevation: 6 },
  liveCalText: { color: '#fff', fontWeight: '900', fontSize: 26, letterSpacing: 0.5 },
  timerBar: { width: '100%', height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden', marginTop: 6 },
  timerFill: { height: '100%', backgroundColor: '#6BCB77', borderRadius: 6 },
  timerText: { color: '#fff', fontWeight: '900', fontSize: 22, marginTop: 8, textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 4 },
  doneCard: { backgroundColor: 'rgba(26,26,46,0.85)', borderRadius: 24, paddingHorizontal: 28, paddingVertical: 22, alignItems: 'center', borderWidth: 3, borderColor: '#FF2E63' },
  flashCard: { backgroundColor: 'rgba(26,26,46,0.85)', borderRadius: 20, paddingHorizontal: 26, paddingVertical: 16, alignItems: 'center', borderWidth: 3, borderColor: '#FFD93D' },
  flashTitle: { color: '#FFD93D', fontWeight: '900', fontSize: 22, textAlign: 'center' },
  doneTitle: { color: '#fff', fontWeight: '900', fontSize: 22, textAlign: 'center' },
  doneSub: { color: '#FFD93D', fontWeight: '700', fontSize: 14, marginTop: 8, textAlign: 'center' },
  loseWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, backgroundColor: 'rgba(0,0,0,0.55)' },
  loseCard: { width: '100%', backgroundColor: '#1a1a2e', borderRadius: 28, paddingHorizontal: 26, paddingVertical: 26, alignItems: 'center', borderWidth: 4, borderColor: '#FF2E63', elevation: 12 },
  loseEmoji: { fontSize: 56 },
  loseTitle: { color: '#FF2E63', fontWeight: '900', fontSize: 40, letterSpacing: 4, marginTop: 6 },
  loseReason: { color: '#fff', fontWeight: '800', fontSize: 16, textAlign: 'center', marginTop: 8 },
  loseStats: { color: '#FFD93D', fontWeight: '800', fontSize: 14, marginTop: 10 },
  loseCost: { color: '#64748b', fontWeight: '700', fontSize: 12, marginTop: 6 },
  recalBtn: { marginTop: 10, backgroundColor: '#00D9FF', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 999 },
  recalText: { color: '#0f172a', fontWeight: '900', fontSize: 13 },
  loseRules: { marginTop: 16, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 16, padding: 14, width: '100%' },
  loseRulesTitle: { color: '#9CA3AF', fontWeight: '900', fontSize: 12, letterSpacing: 2, marginBottom: 8, textAlign: 'center' },
  loseRule: { color: '#e2e8f0', fontWeight: '700', fontSize: 13, marginTop: 4 },
  frameHintPill: { marginTop: 16, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999, borderWidth: 2, borderColor: '#00D9FF' },
  frameHintText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  easyTitle: { fontSize: 34, fontWeight: '900', color: '#1a1a2e', textAlign: 'center', marginTop: 8, backgroundColor: 'rgba(255,255,255,0.9)', paddingHorizontal: 18, paddingVertical: 6, borderRadius: 16, overflow: 'hidden' },
  easySubtitle: { fontSize: 16, color: '#1a1a2e', opacity: 0.85, marginTop: 8, fontWeight: '600', backgroundColor: 'rgba(255,255,255,0.9)', paddingHorizontal: 14, paddingVertical: 4, borderRadius: 12, overflow: 'hidden' },
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#38BDF8', padding: 24, overflow: 'hidden' },
  blob1: { position: 'absolute', width: 300, height: 300, borderRadius: 150, backgroundColor: '#FDE68A', top: -80, right: -90, opacity: 0.9 },
  blob2: { position: 'absolute', width: 260, height: 260, borderRadius: 130, backgroundColor: '#F472B6', bottom: -60, left: -60, opacity: 0.85 },
  blob3: { position: 'absolute', width: 180, height: 180, borderRadius: 90, backgroundColor: '#34D399', top: 220, left: -40, opacity: 0.7 },
  title: { fontSize: 34, fontWeight: '900', color: '#fff', textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.15)', textShadowOffset: { width: 0, height: 3 }, textShadowRadius: 6 },
  modeBadge: { fontSize: 16, fontWeight: '900', color: '#1a1a2e', backgroundColor: '#fff', paddingHorizontal: 18, paddingVertical: 8, borderRadius: 999, overflow: 'hidden', marginBottom: 12, letterSpacing: 1 },
  subtitle: { fontSize: 16, color: '#fff', opacity: 0.95, marginTop: 10, fontWeight: '600' },
  backBtn: { marginTop: 32, backgroundColor: '#fff', paddingHorizontal: 26, paddingVertical: 12, borderRadius: 999, elevation: 4 },
  backText: { color: '#0EA5E9', fontWeight: '800' },
  vsRow: { flexDirection: 'row', gap: 12 },
  vsPick: { marginTop: 18 },
});
