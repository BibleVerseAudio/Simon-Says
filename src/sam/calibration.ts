/**
 * Calibration: guided body-part mapping + personal body profile.
 *
 * SAM 3.1 gives masks/boxes — NOT skeleton joints. All "zones" below are
 * SAM-derived silhouette regions or box-geometry approximations, labelled
 * honestly. Left/right mapping comes from explicit touch-side steps with
 * front-camera mirroring handled (image-x is mirrored: image-left = player-right).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SamBox } from './verifier';

const PROFILE_KEY = 'simonsays.calibration.v1';

export type ZoneName =
  | 'head'
  | 'headSideA'
  | 'headSideB'
  | 'leftShoulder'
  | 'rightShoulder'
  | 'leftHand'
  | 'rightHand'
  | 'hips'
  | 'leftKnee'
  | 'rightKnee'
  | 'feet';

export interface ZoneRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CalibrationProfile {
  version: 1;
  mode: string;
  updatedAt: number;
  rest: SamBox | null;
  neutralArea: number;
  neutralAspect: number;
  neutralCx: number;
  neutralCy: number;
  leftIsImageRight: boolean;
  zones: Partial<Record<ZoneName, ZoneRect>>;
  armsUpDelta: number | null;
  crouchDelta: number | null;
  stepDelta: number | null;
  confidence: number;
}

export interface CalibStep {
  id: string;
  instruction: string;
  zone: ZoneName | null;
  kind: 'still' | 'pose' | 'step';
}

export function calibrationSteps(kids: boolean): CalibStep[] {
  const full: CalibStep[] = [
    { id: 'still0', instruction: 'Stand still and face the camera.', zone: null, kind: 'still' },
    { id: 'touchR', instruction: 'Touch your RIGHT ear. Hold it.', zone: 'rightHand', kind: 'pose' },
    { id: 'touchL', instruction: 'Touch your LEFT ear. Hold it.', zone: 'leftHand', kind: 'pose' },
    { id: 'raise', instruction: 'Raise both hands high. Hold.', zone: null, kind: 'pose' },
    { id: 'head', instruction: 'Touch the top of your head. Hold.', zone: 'head', kind: 'pose' },
    { id: 'cross', instruction: 'Cross your arms. Hold.', zone: null, kind: 'pose' },
    { id: 'crouch', instruction: 'Crouch down a little. Hold.', zone: null, kind: 'pose' },
    { id: 'stepR', instruction: 'Step to YOUR right. Hold.', zone: null, kind: 'step' },
    { id: 'stepL', instruction: 'Step to YOUR left. Hold.', zone: null, kind: 'step' },
    { id: 'still1', instruction: 'Stand still. Done soon.', zone: null, kind: 'still' },
  ];
  if (kids) return [full[0], full[1], full[3], full[6], full[9]];
  return full;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export function zoneRectFor(box: SamBox, zone: ZoneName): ZoneRect {
  const w = Math.max(1, box.w);
  const h = Math.max(1, box.h);
  const nx = (x: number) => x / w;
  const ny = (y: number) => y / h;
  const nw = (x1: number, x2: number) => Math.max(0, (x2 - x1) / w);
  const nh = (y1: number, y2: number) => Math.max(0, (y2 - y1) / h);
  const H = box.y2 - box.y1;
  switch (zone) {
    case 'head':
      return { x: nx(box.x1), y: ny(box.y1), w: nw(box.x1, box.x2), h: nh(box.y1, box.y1 + H * 0.28) };
    case 'headSideA':
      return { x: nx(box.x1), y: ny(box.y1), w: nw(box.x1, box.x1 + (box.x2 - box.x1) * 0.3), h: nh(box.y1, box.y1 + H * 0.28) };
    case 'headSideB':
      return { x: nx(box.x2 - (box.x2 - box.x1) * 0.3), y: ny(box.y1), w: nw(box.x2 - (box.x2 - box.x1) * 0.3, box.x2), h: nh(box.y1, box.y1 + H * 0.28) };
    case 'leftShoulder': {
      const sx1 = (box.x1 + box.x2) / 2;
      return { x: nx(sx1), y: ny(box.y1 + H * 0.28), w: nw(sx1, box.x2), h: 0.14 };
    }
    case 'rightShoulder': {
      const sx2 = (box.x1 + box.x2) / 2;
      return { x: nx(box.x1), y: ny(box.y1 + H * 0.28), w: nw(box.x1, sx2), h: 0.14 };
    }
    case 'leftHand':
      return { x: nx(box.x1), y: ny(box.y1), w: nw(box.x1, box.x1 + w * 0.25), h: 0.3 };
    case 'rightHand': {
      const hx1 = box.x2 - w * 0.25;
      return { x: nx(hx1), y: ny(box.y1), w: nw(hx1, box.x2), h: 0.3 };
    }
    case 'hips':
      return { x: nx(box.x1 + (box.x2 - box.x1) * 0.2), y: ny(box.y1 + H * 0.55), w: nw(box.x1 + (box.x2 - box.x1) * 0.2, box.x2 - (box.x2 - box.x1) * 0.2), h: 0.16 };
    case 'leftKnee':
      return { x: nx((box.x1 + box.x2) / 2), y: ny(box.y1 + H * 0.7), w: 0.2, h: 0.15 };
    case 'rightKnee':
      return { x: nx(box.x1), y: ny(box.y1 + H * 0.7), w: 0.2, h: 0.15 };
    case 'feet':
      return { x: nx(box.x1), y: ny(box.y2 - H * 0.14), w: nw(box.x1, box.x2), h: 0.14 };
  }
}

function clampRect(r: ZoneRect): ZoneRect {
  const x = clamp01(r.x);
  const y = clamp01(r.y);
  return { x, y, w: clamp01(x + r.w) - x, h: clamp01(y + r.h) - y };
}

export function zoneRectClamped(box: SamBox, zone: ZoneName): ZoneRect {
  return clampRect(zoneRectFor(box, zone));
}

export function thresholdScale(profile: CalibrationProfile | null): number {
  if (!profile) return 1;
  const deltas = [profile.armsUpDelta, profile.crouchDelta, profile.stepDelta].filter((d): d is number => d != null && d > 0);
  if (deltas.length === 0) return 1;
  const median = [...deltas].sort((a, b) => a - b)[Math.floor(deltas.length / 2)];
  const scale = Math.min(1.25, Math.max(0.5, median / 0.12));
  return profile.confidence >= 0.7 ? scale : Math.min(1, scale);
}

export async function loadCalibrationProfile(): Promise<CalibrationProfile | null> {
  try {
    const raw = await AsyncStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as CalibrationProfile;
    if (p.version !== 1) return null;
    return p;
  } catch {
    return null;
  }
}

export async function saveCalibrationProfile(p: CalibrationProfile): Promise<void> {
  try {
    await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
  }
}

export async function clearCalibrationProfile(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PROFILE_KEY);
  } catch {
  }
}
