import type { SamBox } from './verifier';

export interface BoxSignature {
  cx: number;
  cy: number;
  area: number;
  aspect: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

export type SignKind =
  | 'STILL'
  | 'RAISE_UP'
  | 'CROUCH_DOWN'
  | 'JUMP_UP'
  | 'STEP_LEFT'
  | 'STEP_RIGHT'
  | 'STEP_FORWARD'
  | 'STEP_BACKWARD'
  | 'WIDEN'
  | 'NARROW'
  | 'LEAN_LEFT'
  | 'LEAN_RIGHT'
  | 'SPIN'
  | 'UNKNOWN';

export interface SignMatch {
  kind: SignKind;
  confidence: number;
  reason: string;
}

const EPS = 1e-6;

export function signatureOf(box: SamBox): BoxSignature {
  const w = Math.max(1, box.w);
  const h = Math.max(1, box.h);
  return {
    cx: (box.x1 + box.x2) / 2 / w,
    cy: (box.y1 + box.y2) / 2 / h,
    area: Math.max(0, (box.x2 - box.x1) * (box.y2 - box.y1)) / (w * h),
    aspect: Math.max(EPS, (box.x2 - box.x1) / Math.max(1, box.y2 - box.y1)),
    top: box.y1 / h,
    bottom: box.y2 / h,
    left: box.x1 / w,
    right: box.x2 / w,
    width: (box.x2 - box.x1) / w,
    height: (box.y2 - box.y1) / h,
  };
}

/** Classify a motion signature from ref → now. */
export function classifySign(before: SamBox, after: SamBox): SignMatch {
  const a = signatureOf(before);
  const b = signatureOf(after);
  const dcx = b.cx - a.cx;
  const dcy = b.cy - a.cy;
  const dArea = a.area > 0 ? (b.area - a.area) / a.area : 0;
  const dAsp = a.aspect > 0 ? (b.aspect - a.aspect) / a.aspect : 0;
  const dTop = b.top - a.top;
  const dBot = b.bottom - a.bottom;
  const dH = b.height - a.height;

  const movedDist = Math.hypot(dcx, dcy);
  if (movedDist < 0.015 && Math.abs(dArea) < 0.03 && Math.abs(dTop) < 0.02) {
    return { kind: 'STILL', confidence: 0.9, reason: `still dx ${(dcx * 100).toFixed(1)}% dy ${(dcy * 100).toFixed(1)}%` };
  }
  if (dTop < -0.06 && dH > 0.06) {
    return { kind: 'RAISE_UP', confidence: Math.min(1, Math.abs(dTop) * 8), reason: `arms up: top ${(dTop * 100).toFixed(0)}% height +${(dH * 100).toFixed(0)}%` };
  }
  // Crouch checked BEFORE widen: a squat widens the box too, so top-edge
  // drop is the stronger signal and must win the ordering.
  if (dTop > 0.05 && dBot >= 0 && dArea > -0.05) {
    return { kind: 'CROUCH_DOWN', confidence: Math.min(1, dTop * 8), reason: `crouch: top +${(dTop * 100).toFixed(0)}% area ${(dArea * 100).toFixed(0)}%` };
  }
  if (dcy < -0.05 && Math.abs(dArea) < 0.15) {
    return { kind: 'JUMP_UP', confidence: Math.min(1, Math.abs(dcy) * 10), reason: `jump: centroid up ${(Math.abs(dcy) * 100).toFixed(1)}%` };
  }
  if (Math.abs(dAsp) > 0.25 && dAsp < 0) {
    return { kind: 'SPIN', confidence: Math.min(1, Math.abs(dAsp) * 2), reason: `spin: aspect ${(dAsp * 100).toFixed(0)}% narrower` };
  }
  if (dAsp > 0.3) {
    return { kind: 'WIDEN', confidence: Math.min(1, dAsp * 2), reason: `widen: aspect +${(dAsp * 100).toFixed(0)}% (arms out / X)` };
  }
  if (dAsp < -0.3) {
    return { kind: 'NARROW', confidence: Math.min(1, Math.abs(dAsp) * 2), reason: `narrow: aspect ${(dAsp * 100).toFixed(0)}% (arms in / fist)` };
  }
  if (dcx < -0.05) return { kind: 'STEP_LEFT', confidence: Math.min(1, Math.abs(dcx) * 10), reason: `step left ${(Math.abs(dcx) * 100).toFixed(1)}%` };
  if (dcx > 0.05) return { kind: 'STEP_RIGHT', confidence: Math.min(1, dcx * 10), reason: `step right ${(dcx * 100).toFixed(1)}%` };
  if (dArea > 0.12) return { kind: 'STEP_FORWARD', confidence: Math.min(1, dArea * 4), reason: `forward: area +${(dArea * 100).toFixed(0)}% (closer)` };
  if (dArea < -0.12) return { kind: 'STEP_BACKWARD', confidence: Math.min(1, Math.abs(dArea) * 4), reason: `backward: area ${(dArea * 100).toFixed(0)}% (farther)` };
  if (dcx < -0.02) return { kind: 'LEAN_LEFT', confidence: 0.5, reason: `lean left ${(dcx * 100).toFixed(1)}%` };
  if (dcx > 0.02) return { kind: 'LEAN_RIGHT', confidence: 0.5, reason: `lean right ${(dcx * 100).toFixed(1)}%` };
  return { kind: 'UNKNOWN', confidence: 0.3, reason: `any motion dx ${(dcx * 100).toFixed(1)} dy ${(dcy * 100).toFixed(1)} area ${(dArea * 100).toFixed(0)}%` };
}

/** Map a command id to the sign(s) that satisfy it. First match wins. */
export function signsForCommand(commandId: string): SignKind[] {
  const id = commandId;
  if (/raise_both_hands|touch_your_head|touch_your_forehead|touch_your_right_ear|touch_your_left_ear|cover_your_eyes|cover_your_mouth|touch_your_nose|touch_your_chin|touch_your_cheeks|wave_/.test(id)) return ['RAISE_UP'];
  if (/touch_your_shoulders|shrug/.test(id)) return ['RAISE_UP', 'WIDEN'];
  if (/cross_your_arms|make_a_fist/.test(id)) return ['NARROW'];
  if (/make_an_x_sign|give_a_thumbs_up|point_at/.test(id)) return ['WIDEN', 'RAISE_UP'];
  if (/clap/.test(id)) return ['NARROW', 'WIDEN'];
  if (/jump/.test(id)) return ['JUMP_UP'];
  if (/spin/.test(id)) return ['SPIN', 'NARROW'];
  if (/squat|sit_up|lie|plank|pushup|mountain|kneel|do_a_burpee|land/.test(id)) return ['CROUCH_DOWN'];
  if (/step_to_the_right|kick_your_right|stomp_your_right/.test(id)) return ['STEP_RIGHT', 'LEAN_RIGHT'];
  if (/step_to_the_left|kick_your_left|stomp_your_left/.test(id)) return ['STEP_LEFT', 'LEAN_LEFT'];
  if (/step_forward/.test(id)) return ['STEP_FORWARD'];
  if (/step_backward|take_two_steps_back/.test(id)) return ['STEP_BACKWARD'];
  if (/stand_on_your_right/.test(id)) return ['LEAN_RIGHT', 'STEP_RIGHT'];
  if (/stand_on_your_left/.test(id)) return ['LEAN_LEFT', 'STEP_LEFT'];
  if (/lift_your_right_knee/.test(id)) return ['CROUCH_DOWN', 'LEAN_LEFT'];
  if (/lift_your_left_knee/.test(id)) return ['CROUCH_DOWN', 'LEAN_RIGHT'];
  if (/march|bend/.test(id)) return ['CROUCH_DOWN', 'STEP_LEFT', 'STEP_RIGHT'];
  if (/twist/.test(id)) return ['SPIN', 'WIDEN', 'NARROW'];
  if (/touch_your_toes|hold_a_plank/.test(id)) return ['CROUCH_DOWN', 'WIDEN'];
  if (/stand_up_tall/.test(id)) return ['RAISE_UP', 'JUMP_UP'];
  return ['UNKNOWN'];
}
