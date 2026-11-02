/**
 * Pose verifier — BlazePose via `vision-camera-pose-detector` (MLKit
 * PoseDetector) frame-processor plugin, offline, ~5MB, no cloud.
 *
 * Pose is the SPECIFIC verifier: SAM boxes prove "you moved"; joints prove
 * "you touched your nose". Each command maps to a landmark check. When the
 * plugin cannot run (frame processors blocked by the worklets collision),
 * `available` is false and GameScreen falls back to SAM-sign-only verdicts.
 * Never throws.
 */

export interface Landmark {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

export type PoseCheck =
  | 'HANDS_UP'
  | 'TOUCH_EAR_R'
  | 'TOUCH_EAR_L'
  | 'TOUCH_NOSE'
  | 'TOUCH_HEAD'
  | 'CROSS_ARMS'
  | 'FIST'
  | 'CLAP'
  | 'SQUAT'
  | 'JUMP'
  | 'HIGH_KNEE_R'
  | 'HIGH_KNEE_L'
  | 'WAVE_R'
  | 'WAVE_L'
  | 'GENERIC_MOVE';

export interface Landmarks {
  nose: Landmark;
  leftEar: Landmark;
  rightEar: Landmark;
  leftShoulder: Landmark;
  rightShoulder: Landmark;
  leftElbow: Landmark;
  rightElbow: Landmark;
  leftWrist: Landmark;
  rightWrist: Landmark;
  leftHip: Landmark;
  rightHip: Landmark;
  leftKnee: Landmark;
  rightKnee: Landmark;
  leftAnkle: Landmark;
  rightAnkle: Landmark;
  head?: Landmark;
}

const d = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Landmark-index map for MLKit PoseDetector output (33 points, BlazePose).
 * See https://developers.google.cn/mediapipe/solutions/vision/pose_landmarker
 * Indices used here follow the standard BlazePose topology.
 */
export const IDX = {
  nose: 0,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
} as const;

export function landmarksFromArray(raw: Array<{ x: number; y: number; z?: number; visibility?: number }> | null | undefined): Landmarks | null {
  if (!raw || raw.length < 29) return null;
  const g = (i: number): Landmark => ({ x: raw[i]?.x ?? 0, y: raw[i]?.y ?? 0, z: raw[i]?.z, visibility: raw[i]?.visibility });
  return {
    nose: g(IDX.nose),
    leftEar: g(IDX.leftEar),
    rightEar: g(IDX.rightEar),
    leftShoulder: g(IDX.leftShoulder),
    rightShoulder: g(IDX.rightShoulder),
    leftElbow: g(IDX.leftElbow),
    rightElbow: g(IDX.rightElbow),
    leftWrist: g(IDX.leftWrist),
    rightWrist: g(IDX.rightWrist),
    leftHip: g(IDX.leftHip),
    rightHip: g(IDX.rightHip),
    leftKnee: g(IDX.leftKnee),
    rightKnee: g(IDX.rightKnee),
    leftAnkle: g(IDX.leftAnkle),
    rightAnkle: g(IDX.rightAnkle),
  };
}

export function checksForCommand(commandId: string): PoseCheck[] {
  const id = commandId;
  if (/raise_both_hands|stand_up_tall/.test(id)) return ['HANDS_UP'];
  if (/touch_your_right_ear/.test(id)) return ['TOUCH_EAR_R'];
  if (/touch_your_left_ear/.test(id)) return ['TOUCH_EAR_L'];
  if (/touch_your_nose/.test(id)) return ['TOUCH_NOSE'];
  if (/touch_your_head|touch_your_forehead|touch_your_shoulders|touch_your_cheeks|cover_/.test(id)) return ['TOUCH_HEAD', 'GENERIC_MOVE'];
  if (/cross_your_arms/.test(id)) return ['CROSS_ARMS'];
  if (/make_a_fist/.test(id)) return ['FIST'];
  if (/clap/.test(id)) return ['CLAP'];
  if (/squat|sit_up|lie|plank|pushup|burpee|kneel|mountain/.test(id)) return ['SQUAT'];
  if (/jump/.test(id)) return ['JUMP'];
  if (/lift_your_right_knee|kick_your_right|stomp_your_right/.test(id)) return ['HIGH_KNEE_R'];
  if (/lift_your_left_knee|kick_your_left|stomp_your_left/.test(id)) return ['HIGH_KNEE_L'];
  if (/wave_your_right/.test(id)) return ['WAVE_R'];
  if (/wave_your_left/.test(id)) return ['WAVE_L'];
  return ['GENERIC_MOVE'];
}

const shoulderWidth = (lm: Landmarks) => Math.max(1e-6, d(lm.leftShoulder, lm.rightShoulder));

export function checkLandmarks(lm: Landmarks, check: PoseCheck): { ok: boolean; reason: string } {
  const sw = shoulderWidth(lm);
  const touch = (a: Landmark, b: Landmark) => d(a, b) < sw * 0.45;
  switch (check) {
    case 'HANDS_UP': {
      const ok = lm.leftWrist.y < lm.leftShoulder.y && lm.rightWrist.y < lm.rightShoulder.y;
      return { ok, reason: ok ? 'both wrists above shoulders' : 'wrists not above shoulders' };
    }
    case 'TOUCH_EAR_R':
      return { ok: touch(lm.rightWrist, lm.rightEar), reason: 'right wrist near right ear' };
    case 'TOUCH_EAR_L':
      return { ok: touch(lm.leftWrist, lm.leftEar), reason: 'left wrist near left ear' };
    case 'TOUCH_NOSE': {
      const ok = touch(lm.leftWrist, lm.nose) || touch(lm.rightWrist, lm.nose);
      return { ok, reason: 'wrist near nose' };
    }
    case 'TOUCH_HEAD': {
      const ok = touch(lm.leftWrist, lm.nose) || touch(lm.rightWrist, lm.nose) || d(lm.leftWrist, lm.leftShoulder) < sw * 0.8;
      return { ok, reason: 'hand near head/shoulder' };
    }
    case 'CROSS_ARMS': {
      const crossed = lm.leftWrist.x > lm.rightShoulder.x - sw * 0.2 && lm.rightWrist.x < lm.leftShoulder.x + sw * 0.2;
      return { ok: crossed, reason: 'wrists crossed across torso' };
    }
    case 'FIST': {
      const ok = d(lm.leftWrist, lm.leftElbow) < sw * 1.1 || d(lm.rightWrist, lm.rightElbow) < sw * 1.1;
      return { ok, reason: 'wrist tucked to elbow' };
    }
    case 'CLAP': {
      const ok = d(lm.leftWrist, lm.rightWrist) < sw * 0.35;
      return { ok, reason: 'wrists together (clap)' };
    }
    case 'SQUAT': {
      const hipY = (lm.leftHip.y + lm.rightHip.y) / 2;
      const kneeY = (lm.leftKnee.y + lm.rightKnee.y) / 2;
      const ok = Math.abs(hipY - kneeY) < 0.08 * Math.max(1, lm.nose.y - hipY + 1);
      return { ok, reason: 'hips dropped toward knees' };
    }
    case 'JUMP': {
      const ok = lm.leftAnkle.y < lm.leftHip.y && lm.rightAnkle.y < lm.rightHip.y;
      return { ok, reason: 'ankles above hips (airborne)' };
    }
    case 'HIGH_KNEE_R': {
      const ok = lm.rightKnee.y < lm.rightHip.y;
      return { ok, reason: 'right knee above hip' };
    }
    case 'HIGH_KNEE_L': {
      const ok = lm.leftKnee.y < lm.leftHip.y;
      return { ok, reason: 'left knee above hip' };
    }
    case 'WAVE_R': {
      const ok = lm.rightWrist.y < lm.rightShoulder.y;
      return { ok, reason: 'right wrist raised (wave)' };
    }
    case 'WAVE_L': {
      const ok = lm.leftWrist.y < lm.leftShoulder.y;
      return { ok, reason: 'left wrist raised (wave)' };
    }
    default:
      return { ok: true, reason: 'any pose (SAM decides)' };
  }
}

/** Plugin handle, lazily required. False when native side is absent. */
let pluginCache: { available: boolean; run: ((frame: any) => Landmarks | null) | null } | null = null;

export function getPosePlugin() {
  if (pluginCache) return pluginCache;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('vision-camera-pose-detector');
    const run = (frame: any): Landmarks | null => {
      try {
        const out = mod.detectPose(frame) ?? mod.default?.(frame) ?? mod.runPoseDetection?.(frame);
        const raw: any[] = Array.isArray(out) ? out : out?.landmarks ?? out?.points ?? [];
        return landmarksFromArray(raw as any);
      } catch {
        return null;
      }
    };
    pluginCache = { available: true, run };
  } catch {
    pluginCache = { available: false, run: null };
  }
  return pluginCache;
}
