/**
 * Real SAM video tracking (clip bursts).
 *
 * During play the game takes 4 stills 500ms apart in the command window,
 * builds a short "video strip" of the 4 boxes in time order, and feeds
 * them to the trajectory scorer. SAM keeps person identity consistent via
 * pickBox IoU-continuity, so bystanders do not hijack the reference.
 *
 * This mirrors SAM video semantics with still photos — same boxes/timeline
 * model, cheaper (4 image calls), no Files API dependency. Falls back to
 * the two-frame delta when fewer frames arrive.
 */
import type { SamBox } from './verifier';

export interface VideoTrack {
  boxes: SamBox[];
  frames: number;
  ok: boolean;
  reason: string;
}

export interface TrackPoint { x: number; y: number }

export function centroidPath(boxes: SamBox[]): TrackPoint[] {
  return boxes.map(b => ({
    x: (b.x1 + b.x2) / 2 / Math.max(1, b.w),
    y: (b.y1 + b.y2) / 2 / Math.max(1, b.h),
  }));
}

export function pathLength(pts: TrackPoint[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return s;
}

export function pathDirection(pts: TrackPoint[]): { dx: number; dy: number } {
  if (pts.length < 2) return { dx: 0, dy: 0 };
  const a = pts[0]; const b = pts[pts.length - 1];
  return { dx: b.x - a.x, dy: b.y - a.y };
}

/** Hold detection: stayed near one pose for the whole track (0..1). */
export function holdScore(pts: TrackPoint[]): number {
  if (pts.length < 2) return 1;
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const spread = Math.max(...pts.map(p => Math.hypot(p.x - cx, p.y - cy)));
  return Math.max(0, 1 - spread * 8);
}

export function makeTrack(boxes: SamBox[], ok = true, reason = 'tracked'): VideoTrack {
  return { boxes, frames: boxes.length, ok, reason };
}
