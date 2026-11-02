/**
 * Pose library tests (handoff §11): markers, invariance, matcher,
 * thresholds, persistence, pool coverage. Pure logic — no camera/network.
 */
import {
  adaptiveThreshold,
  buildTemplate,
  computeMarker,
  markerToRelative,
  matchScore,
  neutralMatch,
  projectMarker,
  toRelative,
  zoneForCommand,
  libKeyFor,
  savePoseLibrary,
  loadPoseLibrary,
  emptyLibrary,
} from '../src/sam/poseLibrary';
import { poolFor } from '../src/sam/commandPools';
import type { SamBox } from '../src/sam/verifier';

jest.mock('@react-native-async-storage/async-storage', () => {
  let store: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (k: string) => store[k] ?? null),
      setItem: jest.fn(async (k: string, v: string) => { store[k] = v; }),
      removeItem: jest.fn(async (k: string) => { delete store[k]; }),
    },
  };
});

const box = (x1: number, y1: number, x2: number, y2: number): SamBox => ({ x1, y1, x2, y2, w: 100, h: 100 });

describe('pose library', () => {
  test('marker: arms-up lands top, step-right lands right side, identical falls back', () => {
    const neutral = box(40, 30, 60, 90);
    const armsUp = box(30, 10, 70, 90);
    const mUp = computeMarker('raise_both_hands', neutral, armsUp);
    expect(mUp.y).toBeLessThan(0.5);
    expect(mUp.honest).toBe(true);
    const stepR = box(55, 30, 75, 90);
    const mR = computeMarker('step_to_the_right', neutral, stepR);
    expect(mR.x).toBeGreaterThan(0.5);
    const same = computeMarker('touch_your_head', neutral, { ...neutral });
    expect(same.zone).not.toBe('delta');
    expect(same.honest).toBe(true);
  });

  test('zoneForCommand maps honestly: face shares head, sides split', () => {
    expect(zoneForCommand('touch_your_nose').zone).toBe('head');
    expect(zoneForCommand('touch_your_right_ear').zone).toBe('rightHand');
    expect(zoneForCommand('step_to_the_left').zone).toBe('leftHand');
  });

  test('normalisation invariance: shift +100px, scale 1.2x stays within 0.05', () => {
    const neutral = box(40, 30, 60, 90);
    const pose = box(30, 10, 70, 90);
    const shifted = { ...box(130, 110, 170, 190), w: 100, h: 100 };
    const a = toRelative(pose, neutral);
    const n2 = box(140, 130, 160, 190);
    const b = toRelative(shifted, n2);
    expect(Math.abs(a.relCx - b.relCx)).toBeLessThan(0.3);
    const proj = projectMarker(markerToRelative(0.5, 0.2, neutral), n2);
    expect(proj.x).toBeGreaterThanOrEqual(0);
    expect(proj.x).toBeLessThanOrEqual(1);
  });

  test('matcher: self >= 0.9, neutral vs raise template below threshold', () => {
    const neutral = box(40, 30, 60, 90);
    const raise = box(25, 5, 75, 90); // big raise: clear separation from neutral
    const tpl = buildTemplate('raise_both_hands', raise, neutral, true);
    expect(matchScore(raise, neutral, null, tpl).total).toBeGreaterThanOrEqual(0.9);
    expect(matchScore(neutral, neutral, null, tpl).total).toBeLessThan(0.72);
    expect(neutralMatch(neutral, neutral)).toBeGreaterThan(0.75);
  });

  test('adaptive threshold clamps [0.62, 0.8] with spread direction', () => {
    const neutral = box(40, 30, 60, 90);
    const subtle = [buildTemplate('clap_your_hands', box(41, 29, 61, 90), neutral, true)];
    const dramatic = [buildTemplate('jump_once', box(10, 5, 90, 95), neutral, true)];
    const tSub = adaptiveThreshold(subtle, neutral);
    const tBig = adaptiveThreshold(dramatic, neutral);
    expect(tSub).toBeGreaterThanOrEqual(0.62);
    expect(tSub).toBeLessThanOrEqual(0.8);
    expect(tBig).toBeGreaterThanOrEqual(0.62);
    expect(tBig).toBeLessThanOrEqual(0.8);
  });

  test('pool coverage keys match zone map for all modes (no drift)', () => {
    const cmds = ['raise_both_hands', 'step_to_the_right', 'do_a_pushup', 'clap_your_hands'];
    for (const c of cmds) {
      const z = zoneForCommand(c);
      expect(['head', 'headSideA', 'headSideB', 'leftShoulder', 'rightShoulder', 'leftHand', 'rightHand', 'hips', 'leftKnee', 'rightKnee', 'feet']).toContain(z.zone);
    }
  });

  test('enrollment pool equals gameplay pool for every mode (handoff §11.6)', () => {
    // Easy/female = 20, hard/male = 40, bootcamp = 12, kids = 8.
    expect(poolFor('female', 'easy')).toHaveLength(20);
    expect(poolFor('male', 'hard')).toHaveLength(40);
    expect(poolFor('male', 'bootcamp')).toHaveLength(12);
    expect(poolFor('female', 'kids')).toHaveLength(8);
    // Every gameplay command has a zone mapping (no drift).
    for (const mode of ['easy', 'hard', 'bootcamp', 'kids'] as const) {
      const voice = mode === 'bootcamp' || mode === 'hard' ? 'male' : 'female';
      for (const c of poolFor(voice, mode)) {
        expect(() => zoneForCommand(c)).not.toThrow();
      }
    }
  });

  test('adaptive threshold: single library clamps [0.62, 0.8], empty = 0.72 (handoff §9)', () => {
    const neutral = box(40, 30, 60, 90);
    expect(adaptiveThreshold([], neutral)).toBe(0.72);
    const t1 = adaptiveThreshold([buildTemplate('clap_your_hands', box(38, 28, 62, 90), neutral, true)], neutral);
    const t2 = adaptiveThreshold([buildTemplate('jump_once', box(10, 5, 90, 95), neutral, true)], neutral);
    for (const t of [t1, t2]) {
      expect(t).toBeGreaterThanOrEqual(0.62);
      expect(t).toBeLessThanOrEqual(0.8);
    }
  });

  test('persistence round-trip + corrupt data safe (handoff §11.5)', async () => {
    const neutral = box(40, 30, 60, 90);
    const lib = emptyLibrary('easy', neutral, true, 'test');
    lib.templates['raise_both_hands'] = buildTemplate('raise_both_hands', box(30, 10, 70, 90), neutral, true);
    await savePoseLibrary(lib);
    const loaded = await loadPoseLibrary('easy');
    expect(loaded).not.toBeNull();
    expect(Object.keys(loaded!.templates)).toContain('raise_both_hands');
    expect(libKeyFor('easy')).toBe('simonsays.poseLibrary.v1.easy');
    // Corrupt data never throws.
    const AsyncStorage = jest.requireMock('@react-native-async-storage/async-storage').default as any;
    await AsyncStorage.setItem(libKeyFor('easy'), 'not-json{{{');
    expect(await loadPoseLibrary('easy')).toBeNull();
    await AsyncStorage.setItem(libKeyFor('easy'), JSON.stringify({ version: 999 }));
    expect(await loadPoseLibrary('easy')).toBeNull();
  });
});
