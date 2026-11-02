/**
 * Silhouette-match game logic (the innovation mechanic).
 *
 * A target silhouette (grid profile) is shown; the player copies the body
 * shape. SAM mask/box profile similarity >= threshold wins.
 * Pure logic, unit-testable.
 */
import { gridFromBox, shapeSimilarity, type GridProfile } from './gridProfile';
import type { SamBox } from './verifier';

export interface ShapeTarget {
  id: string;
  label: string;
  emoji: string;
  target: GridProfile;
}

/** Synthetic target profiles built from shape primitives (6x8 grid). */
function profileFrom(fn: (c: number, r: number) => number): GridProfile {
  const cols = 6; const rows = 8;
  const cells: number[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push(fn(c, r));
  // Reuse summarizer via gridProfile's summarize (exported indirectly through gridFromBox shape)
  // Compute totals inline to avoid an extra import cycle.
  const total = cells.reduce((a, b) => a + b, 0) || 1;
  let top = 0, bot = 0, left = 0, right = 0, sx = 0, sy = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const v = cells[r * cols + c];
    if (r < rows / 3) top += v; else if (r >= (2 * rows) / 3) bot += v;
    if (c < cols / 2) left += v; else right += v;
    sx += v * (c + 0.5) / cols; sy += v * (r + 0.5) / rows;
  }
  return { cols, rows, cells, topMass: top / total, bottomMass: bot / total, leftMass: left / total, rightMass: right / total, centroidX: sx / total, centroidY: sy / total };
}

export const SHAPE_TARGETS: ShapeTarget[] = [
  {
    id: 'arms_up', label: 'Arms Up — be a goalpost', emoji: '🙌',
    target: profileFrom((c, r) => (r < 2 && (c === 0 || c === 5) ? 1 : (r < 2 ? 0.4 : r < 6 ? 0.8 : 1))),
  },
  {
    id: 'wide_x', label: 'Make an X — wide and tall', emoji: '✖️',
    target: profileFrom((c, r) => ((c === 0 || c === 5) && r < 2) || ((c === 2 || c === 3) && r >= 3 && r < 6) || (r >= 6 && (c === 0 || c === 5)) ? 1 : 0.2),
  },
  {
    id: 'crouch_low', label: 'Crouch Low — get small', emoji: '🦔',
    target: profileFrom((c, r) => (r >= 6 ? 1 : r >= 4 ? 0.7 : 0.15)),
  },
  {
    id: 'lean_left', label: 'Lean Left', emoji: '↙️',
    target: profileFrom((c, r) => (c < 3 ? 1 : 0.15)),
  },
  {
    id: 'lean_right', label: 'Lean Right', emoji: '↘️',
    target: profileFrom((c, r) => (c >= 3 ? 1 : 0.15)),
  },
  {
    id: 't_pose', label: 'T-Pose — arms straight out', emoji: '✈️',
    target: profileFrom((c, r) => (r === 2 ? 1 : (c === 2 || c === 3) && r > 2 ? 0.9 : 0.2)),
  },
];

export function scoreShape(playerBox: SamBox, target: ShapeTarget): { score: number; pass: boolean } {
  const p = gridFromBox(playerBox);
  const score = shapeSimilarity(p, target.target);
  return { score, pass: score >= 0.72 };
}
