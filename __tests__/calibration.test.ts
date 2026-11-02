/**
 * Calibration + silhouette-grid tests (innovation layer).
 * Pure logic — no camera, no network.
 */
import { calibrationSteps, thresholdScale, zoneRectClamped, type CalibrationProfile } from '../src/sam/calibration';
import { gridFromBox, profileDelta, shapeSimilarity } from '../src/sam/gridProfile';
import { SHAPE_TARGETS, scoreShape } from '../src/sam/shapeGame';

const box = (x1: number, y1: number, x2: number, y2: number) => ({ x1, y1, x2, y2, w: 100, h: 100 });

describe('calibration zones + personal scale (Wonder spec)', () => {
  test('zone rects stay inside the frame', () => {
    for (const z of ['head', 'headSideA', 'headSideB', 'leftShoulder', 'rightShoulder', 'leftHand', 'rightHand', 'hips', 'leftKnee', 'rightKnee', 'feet'] as const) {
      const r = zoneRectClamped(box(100, 50, 300, 450) as any, z);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(1.01);
      expect(r.y + r.h).toBeLessThanOrEqual(1.01);
    }
  });

  test('kids calibration is short, adults full', () => {
    expect(calibrationSteps(true).length).toBeLessThanOrEqual(5);
    expect(calibrationSteps(false).length).toBeGreaterThan(5);
  });

  test('threshold scale visibly changes thresholds for subtle movers', () => {
    const p = { version: 1, mode: 'easy', updatedAt: 0, rest: null, neutralArea: 0.2, neutralAspect: 0.7, neutralCx: 0.5, neutralCy: 0.5, leftIsImageRight: true, zones: {}, armsUpDelta: 0.06, crouchDelta: 0.06, stepDelta: 0.06, confidence: 0.8 } as CalibrationProfile;
    expect(thresholdScale(p)).toBeLessThan(1);
    expect(thresholdScale(null)).toBe(1);
  });

  test('grid profile: centered box splits mass evenly', () => {
    const g = gridFromBox(box(25, 25, 75, 75));
    expect(g.cells.length).toBe(48);
    expect(g.leftMass).toBeGreaterThan(0.3);
    expect(g.rightMass).toBeGreaterThan(0.3);
    expect(shapeSimilarity(g, g)).toBe(1);
  });

  test('shape targets are scorable and distinct', () => {
    const ids = new Set(SHAPE_TARGETS.map(t => t.id));
    expect(ids.size).toBe(SHAPE_TARGETS.length);
    const wide = SHAPE_TARGETS.find(t => t.id === 'lean_left')!;
    const s = scoreShape(box(5, 20, 45, 90), wide);
    expect(s.score).toBeGreaterThanOrEqual(0);
    expect(typeof s.pass).toBe('boolean');
    const d = profileDelta(gridFromBox(box(40, 30, 60, 90)), gridFromBox(box(20, 10, 80, 90)));
    expect(Math.abs(d.dCX)).toBeLessThan(1);
  });
});
