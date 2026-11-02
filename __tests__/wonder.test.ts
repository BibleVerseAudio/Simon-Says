/**
 * Wonder review gates: profile scale + Spark fallback. No camera, no network.
 */
import { calibrationSteps, thresholdScale, type CalibrationProfile } from '../src/sam/calibration';
import { adviseNextStage } from '../src/intelligence/museSpark';

const profile = (d: number, c: number): CalibrationProfile => ({
  version: 1,
  mode: 'easy',
  updatedAt: Date.now(),
  rest: null,
  neutralArea: 0.2,
  neutralAspect: 0.7,
  neutralCx: 0.5,
  neutralCy: 0.5,
  leftIsImageRight: true,
  zones: {},
  armsUpDelta: d,
  crouchDelta: d,
  stepDelta: d,
  confidence: c,
});

describe('wonder gates', () => {
  test('thresholdScale visibly changes thresholds for subtle movers', () => {
    expect(thresholdScale(profile(0.06, 0.8))).toBeLessThan(1);
    expect(thresholdScale(null)).toBe(1);
  });

  test('kids calibration is short', () => {
    expect(calibrationSteps(true).length).toBeLessThanOrEqual(5);
    expect(calibrationSteps(false).length).toBeGreaterThan(5);
  });

  test('Spark falls back locally with no key (timeout-safe)', async () => {
    const a = await adviseNextStage({ mode: 'easy', stage: 2, speed: 1, score: 5, hits: 5, tries: 6, streak: 3, recentFailReason: null, unverifiedCount: 0 });
    expect([1, 0, -1]).toContain(a.nextStageDelta);
    expect(typeof a.feedback).toBe('string');
  }, 15000);
});
