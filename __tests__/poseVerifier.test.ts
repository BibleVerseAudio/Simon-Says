/**
 * Pose-verifier tests: joint-level checks that SAM boxes cannot express.
 * Fixtures are synthetic BlazePose landmark arrays (normalized 0..1).
 */
import {
  checkLandmarks,
  checksForCommand,
  landmarksFromArray,
  type Landmarks,
} from '../src/sam/poseVerifier';

function makeLm(patch: Partial<Record<string, { x: number; y: number }>> = {}): Landmarks {
  const base: Record<string, { x: number; y: number }> = {
    nose: { x: 0.5, y: 0.2 },
    leftEar: { x: 0.45, y: 0.22 },
    rightEar: { x: 0.55, y: 0.22 },
    leftShoulder: { x: 0.4, y: 0.35 },
    rightShoulder: { x: 0.6, y: 0.35 },
    leftElbow: { x: 0.35, y: 0.55 },
    rightElbow: { x: 0.65, y: 0.55 },
    leftWrist: { x: 0.35, y: 0.75 },
    rightWrist: { x: 0.65, y: 0.75 },
    leftHip: { x: 0.45, y: 0.65 },
    rightHip: { x: 0.55, y: 0.65 },
    leftKnee: { x: 0.45, y: 0.85 },
    rightKnee: { x: 0.55, y: 0.85 },
    leftAnkle: { x: 0.45, y: 0.98 },
    rightAnkle: { x: 0.55, y: 0.98 },
  };
  Object.assign(base, patch);
  const arr: any[] = [];
  arr[0] = base.nose;
  arr[7] = base.leftEar;
  arr[8] = base.rightEar;
  arr[11] = base.leftShoulder;
  arr[12] = base.rightShoulder;
  arr[13] = base.leftElbow;
  arr[14] = base.rightElbow;
  arr[15] = base.leftWrist;
  arr[16] = base.rightWrist;
  arr[23] = base.leftHip;
  arr[24] = base.rightHip;
  arr[25] = base.leftKnee;
  arr[26] = base.rightKnee;
  arr[27] = base.leftAnkle;
  arr[28] = base.rightAnkle;
  for (let i = 0; i < 33; i++) if (!arr[i]) arr[i] = { x: 0.5, y: 0.5 };
  return landmarksFromArray(arr)!;
}

describe('pose verifier', () => {
  test('hands up vs down', () => {
    expect(checkLandmarks(makeLm(), 'HANDS_UP').ok).toBe(false);
    const up = makeLm({ leftWrist: { x: 0.4, y: 0.1 }, rightWrist: { x: 0.6, y: 0.1 } });
    expect(checkLandmarks(up, 'HANDS_UP').ok).toBe(true);
  });

  test('touch ears and nose are side-specific', () => {
    const r = makeLm({ rightWrist: { x: 0.56, y: 0.22 } });
    expect(checkLandmarks(r, 'TOUCH_EAR_R').ok).toBe(true);
    expect(checkLandmarks(r, 'TOUCH_EAR_L').ok).toBe(false);
    const n = makeLm({ leftWrist: { x: 0.51, y: 0.2 } });
    expect(checkLandmarks(n, 'TOUCH_NOSE').ok).toBe(true);
  });

  test('cross arms and clap', () => {
    const cross = makeLm({ leftWrist: { x: 0.62, y: 0.5 }, rightWrist: { x: 0.38, y: 0.5 } });
    expect(checkLandmarks(cross, 'CROSS_ARMS').ok).toBe(true);
    const clap = makeLm({ leftWrist: { x: 0.49, y: 0.6 }, rightWrist: { x: 0.51, y: 0.6 } });
    expect(checkLandmarks(clap, 'CLAP').ok).toBe(true);
  });

  test('high knees are side-specific', () => {
    const r = makeLm({ rightKnee: { x: 0.55, y: 0.5 } });
    expect(checkLandmarks(r, 'HIGH_KNEE_R').ok).toBe(true);
    expect(checkLandmarks(r, 'HIGH_KNEE_L').ok).toBe(false);
  });

  test('command tables cover specific verifier checks', () => {
    expect(checksForCommand('touch_your_right_ear')).toEqual(['TOUCH_EAR_R']);
    expect(checksForCommand('raise_both_hands')).toEqual(['HANDS_UP']);
    expect(checksForCommand('cross_your_arms')).toEqual(['CROSS_ARMS']);
    expect(checksForCommand('lift_your_left_knee')).toEqual(['HIGH_KNEE_L']);
    expect(checksForCommand('touch_your_nose')).toEqual(['TOUCH_NOSE']);
  });
});
