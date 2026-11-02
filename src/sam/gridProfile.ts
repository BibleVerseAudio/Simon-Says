/**
 * Silhouette grid analysis (SAM masks decoded to a 6x8 occupancy grid).
 * This is the innovation layer: SAM gives a pixel region, not joints.
 * We divide it into zones and read WHERE the mass is — top/bottom, left/right.
 * Mechanic: "break the silhouette" — actions change the grid profile in
 * ways a pose model would need 33 keypoints to express.
 * Pure functions, unit-testable without network.
 */
import type { SamBox } from './verifier';

export interface GridProfile {
  cols: number;
  rows: number;
  cells: number[]; // row-major fractions 0..1, length cols*rows
  topMass: number;
  bottomMass: number;
  leftMass: number;
  rightMass: number;
  centroidX: number;
  centroidY: number;
}

/**
 * Approximate a SAM mask as a grid profile on a FIXED frame grid (6x8).
 * Each cell covers frame x [c/cols,(c+1)/cols], y [r/rows,(r+1)/rows] and is
 * 1 when the cell centre falls inside the person box. Frame-fixed means
 * MOVEMENT changes the grid (unlike the old box-normalised version where
 * same-size boxes always produced identical grids). Pure + testable.
 */
export function gridFromBox(box: SamBox, cols = 6, rows = 8): GridProfile {
  const cells: number[] = new Array(cols * rows).fill(0);
  const w = Math.max(1, box.w);
  const h = Math.max(1, box.h);
  const x1 = box.x1 / w;
  const x2 = box.x2 / w;
  const y1 = box.y1 / h;
  const y2 = box.y2 / h;
  for (let r = 0; r < rows; r++) {
    const cy = (r + 0.5) / rows;
    for (let c = 0; c < cols; c++) {
      const cx = (c + 0.5) / cols;
      if (cx >= x1 && cx <= x2 && cy >= y1 && cy <= y2) cells[r * cols + c] = 1;
    }
  }
  const bw = (box.x2 - box.x1) / w;
  const bh = (box.y2 - box.y1) / h;
  return summarize(cells, cols, rows, bw, bh);
}

export function summarize(cells: number[], cols: number, rows: number, bw = 1, bh = 1): GridProfile {
  const total = cells.reduce((a, b) => a + b, 0) || 1;
  let top = 0, bot = 0, left = 0, right = 0, sx = 0, sy = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = cells[r * cols + c];
      if (r < rows / 3) top += v; else if (r >= (2 * rows) / 3) bot += v;
      if (c < cols / 2) left += v; else right += v;
      sx += v * (c + 0.5) / cols; sy += v * (r + 0.5) / rows;
    }
  }
  return {
    cols, rows, cells,
    topMass: top / total, bottomMass: bot / total,
    leftMass: left / total, rightMass: right / total,
    centroidX: sx / total, centroidY: sy / total,
  };
}

/** Shape-match score 0..1 between two grid profiles (demo mechanic). */
export function shapeSimilarity(a: GridProfile, b: GridProfile): number {
  const n = Math.min(a.cells.length, b.cells.length);
  if (n === 0) return 0;
  let same = 0;
  for (let i = 0; i < n; i++) same += 1 - Math.min(1, Math.abs(a.cells[i] - b.cells[i]));
  return same / n;
}

/** Change summary used by game rules (top-heavy, wide, etc.). */
export function profileDelta(before: GridProfile, after: GridProfile) {
  return {
    dTop: after.topMass - before.topMass,
    dBottom: after.bottomMass - before.bottomMass,
    dLeft: after.leftMass - before.leftMass,
    dRight: after.rightMass - before.rightMass,
    dCX: after.centroidX - before.centroidX,
    dCY: after.centroidY - before.centroidY,
  };
}
