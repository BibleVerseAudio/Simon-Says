/**
 * Referee unit tests (Wonder P1): judge tables, expected semantics,
 * box picking, jerk bands. Pure logic — no camera, no network.
 */
import {
  judgeMove,
  parseSamBoxes,
  pickBox,
  scoreJerk,
  type SamBox,
} from '../src/sam/verifier';

const W = 100;
const H = 100;
const box = (x1: number, y1: number, x2: number, y2: number, c?: number): SamBox => ({
  x1,
  y1,
  x2,
  y2,
  w: W,
  h: H,
  confidence: c,
});

describe('verifier', () => {
  test('parseSamBoxes reads first and multiple boxes + confidence', () => {
    const wire =
      '<0f>0<|box;x1=10;y1=10;x2=50;y2=60;w=100;h=100|>,' +
      '1<|box;x1=60;y1=10;x2=90;y2=60;w=100;h=100;c=0.93|>';
    const boxes = parseSamBoxes(wire);
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toMatchObject({ x1: 10, x2: 50 });
    expect(boxes[1].confidence).toBeCloseTo(0.93);
  });

  test('simon-says: move passes, still fails', () => {
    const rest = box(40, 40, 60, 80);
    const moved = box(20, 10, 80, 90); // big grow
    const still = box(41, 41, 60, 80);
    expect(judgeMove('raise_both_hands', 'move', rest, moved, false).kind).toBe('PASS');
    expect(judgeMove('raise_both_hands', 'move', rest, still, false).kind).toBe('FAIL_MOVE');
  });

  test('bare trap: still passes, move fails', () => {
    const rest = box(40, 40, 60, 80);
    const moved = box(20, 10, 80, 90);
    const still = box(41, 41, 60, 80);
    expect(judgeMove('raise_both_hands', 'freeze', rest, still, false).kind).toBe('PASS');
    const v = judgeMove('raise_both_hands', 'freeze', rest, moved, false);
    expect(v.kind).toBe('FAIL_MOVE');
    expect(v.reason).toMatch(/Simon says/);
  });

  test('null boxes are UNVERIFIED (never a loss), kids forgiving', () => {
    expect(judgeMove('jump_once', 'move', null, box(1, 1, 2, 2), false).kind).toBe('UNVERIFIED');
    expect(judgeMove('jump_once', 'move', box(1, 1, 2, 2), null, false).kind).toBe('UNVERIFIED');
    expect(judgeMove('jump_once', 'move', null, null, true).kind).toBe('PASS');
  });

  test('pickBox prefers continuity, rejects ambiguity', () => {
    const ref = box(40, 40, 60, 80);
    const same = box(41, 41, 61, 81, 0.9);
    const other = box(5, 5, 15, 20, 0.4);
    expect(pickBox([same, other], ref)).toEqual(same);
    const twinA = box(10, 10, 30, 30);
    const twinB = box(60, 60, 80, 80);
    expect(pickBox([twinA, twinB], null)).toBeNull();
  });

  test('scoreJerk bands: still < firm < jerky', () => {
    const still = scoreJerk(
      [
        { x: 0.5, y: 0.5 },
        { x: 0.501, y: 0.5 },
        { x: 0.502, y: 0.5 },
      ],
      0.4,
    );
    expect(still.smoothness).toBe('smooth');
    const thrash = scoreJerk(
      [
        { x: 0.2, y: 0.5 },
        { x: 0.8, y: 0.5 },
        { x: 0.2, y: 0.5 },
        { x: 0.8, y: 0.5 },
      ],
      0.4,
    );
    expect(['firm', 'jerky']).toContain(thrash.smoothness);
  });
});
