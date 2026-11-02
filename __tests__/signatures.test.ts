/**
 * SAM signature engine tests (hackathon showcase layer):
 * box-geometry classification + per-command sign tables. Pure logic.
 */
import { classifySign, signatureOf, signsForCommand, type SignKind } from '../src/sam/signatures';
import type { SamBox } from '../src/sam/verifier';

const box = (x1: number, y1: number, x2: number, y2: number): SamBox => ({
  x1,
  y1,
  x2,
  y2,
  w: 100,
  h: 100,
});

describe('SAM signature engine', () => {
  test('signature geometry: centroid / area / aspect', () => {
    const s = signatureOf(box(25, 10, 75, 90));
    expect(s.cx).toBeCloseTo(0.5);
    expect(s.cy).toBeCloseTo(0.5);
    expect(s.area).toBeCloseTo(0.4);
    expect(s.aspect).toBeCloseTo(0.625);
  });

  test('still vs raise vs crouch vs step', () => {
    const rest = box(40, 30, 60, 90);
    expect(classifySign(rest, box(40, 30, 60, 90)).kind).toBe('STILL');
    expect(classifySign(rest, box(25, 5, 75, 90)).kind).toBe('RAISE_UP'); // top up, taller
    expect(classifySign(rest, box(30, 40, 70, 90)).kind).toBe('CROUCH_DOWN'); // top down
    expect(classifySign(rest, box(10, 30, 35, 90)).kind).not.toBe('STILL');
  });

  test('command sign tables cover the catalogue', () => {
    expect(signsForCommand('raise_both_hands')).toContain<SignKind>('RAISE_UP');
    expect(signsForCommand('touch_your_nose')).toContain<SignKind>('RAISE_UP');
    expect(signsForCommand('cross_your_arms')).toContain<SignKind>('NARROW');
    expect(signsForCommand('jump_once')).toContain<SignKind>('JUMP_UP');
    expect(signsForCommand('spin_around')).toContain<SignKind>('SPIN');
    expect(signsForCommand('touch_your_toes')).toContain<SignKind>('CROUCH_DOWN');
    expect(signsForCommand('stand_on_your_right_leg').length).toBeGreaterThan(0);
    expect(signsForCommand('do_a_burpee').length).toBeGreaterThan(0);
  });

  test('unknown sign reserved for micro moves', () => {
    const rest = box(40, 30, 60, 90);
    const tiny = classifySign(rest, box(41, 31, 60, 90));
    expect(['STILL', 'UNKNOWN', 'LEAN_LEFT', 'LEAN_RIGHT']).toContain(tiny.kind);
  });
});
