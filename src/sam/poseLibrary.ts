/**
 * Pose library: pre-game ENROLLMENT of personal reference templates.
 *
 * Honesty: SAM 3.1 gives boxes/masks — NOT skeleton joints. Markers are
 * SAM-derived ZONE markers (silhouette-change centroid, zone-rect fallback),
 * never anatomical joints. Facial commands share the head zone.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SamBox } from './verifier';
import { gridFromBox, shapeSimilarity, profileDelta, type GridProfile } from './gridProfile';
import { signatureOf, classifySign, type SignKind } from './signatures';
import { zoneRectClamped, zoneRectFor, type ZoneName } from './calibration';

export const POSE_LIB_VERSION = 1;
export const libKeyFor = (mode: string): string => `simonsays.poseLibrary.v1.${mode}`;

export interface PoseMarkerRel {
  x: number; // neutral-relative 0..1
  y: number;
  zone: ZoneName | 'delta'; // fallback zone used, or 'delta' for change-region
  honest: true; // markers are SAM zones, never joints
}

export interface PoseTemplate {
  commandId: string;
  box: SamBox; // agreed enrollment box
  relCx: number; // body-relative signature centre offsets
  relCy: number;
  relArea: number; // ratio to neutral area
  relAspect: number; // ratio to neutral aspect
  relTop: number;
  relHeight: number;
  grid: number[]; // 6x8 body-relative cells
  marker: PoseMarkerRel;
  sign: SignKind;
  confidence: number;
  at: number;
}

export interface PoseLibrary {
  version: 1;
  mode: string;
  updatedAt: number;
  neutralBox: SamBox;
  neutralGrid: number[];
  leftIsImageRight: boolean;
  framing: string;
  passThreshold: number; // adaptive, clamp [0.62, 0.8]
  templates: Record<string, PoseTemplate>;
}

export interface ZoneForCommand {
  zone: ZoneName;
  label: string;
}

/** Command -> fallback SAM zone. Facial commands all share head (honest). */
export function zoneForCommand(commandId: string): ZoneForCommand {
  const id = commandId;
  if (/touch_your_right_ear|wave_your_right_hand|kick_your_right|stomp_your_right|step_to_the_right|lift_your_right|stand_on_your_right/.test(id)) return { zone: 'rightHand', label: 'right side zone' };
  if (/touch_your_left_ear|wave_your_left_hand|kick_your_left|stomp_your_left|step_to_the_left|lift_your_left|stand_on_your_left/.test(id)) return { zone: 'leftHand', label: 'left side zone' };
  if (/raise_both_hands|make_an_x_sign|clap_your_hands|touch_your_head|touch_your_forehead|touch_your_nose|touch_your_chin|touch_your_cheeks|cover_your_eyes|cover_your_mouth/.test(id)) return { zone: 'head', label: 'head zone' };
  if (/cross_your_arms|touch_your_shoulders|shrug_your_shoulders|make_a_fist|give_a_thumbs_up|point_at_the_camera/.test(id)) return { zone: 'leftShoulder', label: 'shoulder zone' };
  if (/touch_your_toes|bend_your_knees|do_a_squat|march_in_place|sit_up|lie_on_your_back|get_into_pushup_position|do_a_pushup|hold_a_plank|do_jumping_jacks|do_a_burpee|do_mountain_climbers|sit_down_and_stand_up|lie_down_and_jump_up|kneel_down|stand_up_tall|twist_your_hips/.test(id)) return { zone: 'hips', label: 'hips zone' };
  if (/jump_once|spin_around|step_forward|step_backward|take_two_steps_back/.test(id)) return { zone: 'feet', label: 'feet zone' };
  return { zone: 'head', label: 'head zone' };
}

/** Body-relative signature: offsets/ratios vs neutral (translation+scale invariant). */
export function toRelative(box: SamBox, neutral: SamBox): Pick<PoseTemplate, 'relCx' | 'relCy' | 'relArea' | 'relAspect' | 'relTop' | 'relHeight'> {
  const s = signatureOf(box);
  const n = signatureOf(neutral);
  const nArea = Math.max(1e-6, n.area);
  return {
    relCx: s.cx - n.cx,
    relCy: s.cy - n.cy,
    relArea: s.area / nArea,
    relAspect: s.aspect / Math.max(1e-6, n.aspect),
    relTop: s.top - n.top,
    relHeight: s.height / Math.max(1e-6, n.height),
  };
}

/** Change-region centroid: grid cells with largest neutral->pose change.
 * Uses strict top-k weighting so small deltas still localise (Wonder: the
 * uniform average washed out to ~0.47 and failed the top-region check). */
export function changeCentroid(neutralBox: SamBox, poseBox: SamBox, minTotal = 0.02): { x: number; y: number; total: number } | null {
  const ng = gridFromBox(neutralBox);
  const pg = gridFromBox(poseBox);
  let sx = 0;
  let sy = 0;
  let total = 0;
  const pairs: { d: number; c: number; r: number }[] = [];
  for (let i = 0; i < ng.cells.length; i++) {
    const d = Math.abs(pg.cells[i] - ng.cells[i]);
    if (d <= 0) continue;
    const c = i % ng.cols;
    const r = Math.floor(i / ng.cols);
    pairs.push({ d, c, r });
  }
  for (const p of pairs) total += p.d;
  if (total < minTotal) return null;
  // Top-half of changed cells by weight: localise the change, not the mean.
  pairs.sort((a, b) => b.d - a.d);
  const keep = pairs.slice(0, Math.max(1, Math.ceil(pairs.length / 2)));
  let kw = 0;
  for (const p of keep) {
    const w = p.d * p.d;
    sx += w * ((p.c + 0.5) / ng.cols);
    sy += w * ((p.r + 0.5) / ng.rows);
    kw += w;
  }
  if (kw <= 0) return null;
  return { x: sx / kw, y: sy / kw, total };
}

/** Compute an honest SAM zone marker: change centroid, else zone-rect centre. */
export function computeMarker(commandId: string, neutralBox: SamBox, poseBox: SamBox): PoseMarkerRel {
  const ch = changeCentroid(neutralBox, poseBox);
  if (ch) {
    return { x: Math.min(1, Math.max(0, ch.x)), y: Math.min(1, Math.max(0, ch.y)), zone: 'delta', honest: true };
  }
  const { zone } = zoneForCommand(commandId);
  const z = zoneRectClamped(neutralBox, zone);
  return { x: Math.min(1, Math.max(0, z.x + z.w / 2)), y: Math.min(1, Math.max(0, z.y + z.h / 2)), zone, honest: true };
}

/** Neutral-relative marker from frame coords (for stored lib load/verify). */
export function markerToRelative(fx: number, fy: number, neutral: SamBox): { x: number; y: number } {
  const nw = Math.max(1, neutral.x2 - neutral.x1);
  const nh = Math.max(1, neutral.y2 - neutral.y1);
  return {
    x: Math.min(1.2, Math.max(-0.2, ((fx * neutral.w - neutral.x1) / nw))),
    y: Math.min(1.2, Math.max(-0.2, ((fy * neutral.h - neutral.y1) / nh))),
  };
}

/** Project a neutral-relative marker onto today's neutral box (frame coords 0..1). */
export function projectMarker(m: { x: number; y: number }, neutral: SamBox): { x: number; y: number } {
  const nw = Math.max(1, neutral.x2 - neutral.x1);
  const nh = Math.max(1, neutral.y2 - neutral.y1);
  const px = (neutral.x1 + m.x * nw) / Math.max(1, neutral.w);
  const py = (neutral.y1 + m.y * nh) / Math.max(1, neutral.h);
  return { x: Math.min(1, Math.max(0, px)), y: Math.min(1, Math.max(0, py)) };
}

/** Build one template from an agreed enrollment box + neutral baseline. */
export function buildTemplate(commandId: string, poseBox: SamBox, neutralBox: SamBox, leftIsImageRight: boolean): PoseTemplate {
  void leftIsImageRight;
  const rel = toRelative(poseBox, neutralBox);
  const g = gridFromBox(poseBox);
  return {
    commandId,
    box: poseBox,
    ...rel,
    grid: [...g.cells],
    marker: computeMarker(commandId, neutralBox, poseBox),
    sign: classifySign(neutralBox, poseBox).kind,
    confidence: poseBox.confidence ?? 0.9,
    at: Date.now(),
  };
}

export interface MatchBreakdown {
  total: number;
  signatureScore: number;
  gridScore: number;
  markerScore: number;
}

/** Match a live box against a template (body-relative). */
export function matchScore(liveBox: SamBox, neutralBox: SamBox, prevBox: SamBox | null, template: PoseTemplate): MatchBreakdown {
  const lr = toRelative(liveBox, neutralBox);
  const dArea = Math.abs(lr.relArea - template.relArea) / Math.max(0.5, template.relArea);
  const dAsp = Math.abs(lr.relAspect - template.relAspect) / Math.max(0.5, template.relAspect);
  // Wonder: neutral-vs-pose must discriminate — cx/cy/aspect carry the
  // pose identity (grid alone over-scores the shared silhouette mass).
  // Handoff §8 weights: area 0.25, aspect 0.2, cx 0.15, cy 0.15, top 0.15,
  // height 0.1 — normalised so identical boxes score 1.0, distinct poses
  // separate. Self-match must reach >= 0.9 (test gate).
  const d = Math.abs(lr.relCx - template.relCx) * 0.15
    + Math.abs(lr.relCy - template.relCy) * 0.15
    + Math.min(2, dArea) * 0.25
    + Math.min(2, dAsp) * 0.2
    + Math.abs(lr.relTop - template.relTop) * 0.15
    + Math.abs(lr.relHeight - template.relHeight) * 0.1;
  const signatureScore = Math.min(1, Math.max(0, 1 - d));
  const liveGrid: GridProfile = gridFromBox(liveBox);
  const tplGrid: GridProfile = {
    cols: 6, rows: 8, cells: template.grid,
    topMass: 0, bottomMass: 0, leftMass: 0, rightMass: 0, centroidX: 0.5, centroidY: 0.5,
  };
  const gridScore = shapeSimilarity(liveGrid, tplGrid);
  let markerScore = 0.5;
  try {
    if (prevBox) {
      const ch = changeCentroid(prevBox, liveBox);
      if (ch) {
        const liveRel = markerToRelative(ch.x, ch.y, neutralBox);
        markerScore = Math.min(1, Math.max(0, 1 - Math.hypot(liveRel.x - template.marker.x, liveRel.y - template.marker.y) * 2));
      }
    } else {
      const ch = changeCentroid(neutralBox, liveBox);
      if (ch) {
        const liveRel = markerToRelative(ch.x, ch.y, neutralBox);
        markerScore = Math.min(1, Math.max(0, 1 - Math.hypot(liveRel.x - template.marker.x, liveRel.y - template.marker.y) * 2));
      }
    }
  } catch {
    markerScore = 0.5;
  }
  const total = Math.min(1, Math.max(0, 0.45 * signatureScore + 0.45 * gridScore + 0.1 * markerScore));
  return { total, signatureScore, gridScore, markerScore };
}

/** Neutral-template match (for trap logic): live vs neutral-as-template. */
export function neutralMatch(liveBox: SamBox, neutralBox: SamBox): number {
  const lr = toRelative(liveBox, neutralBox);
  const d = Math.abs(lr.relCx) * 2 + Math.abs(lr.relCy) * 2 + Math.abs(lr.relArea - 1) + Math.abs(lr.relAspect - 1) * 0.5;
  return Math.min(1, Math.max(0, 1 - d / 2));
}

/** Adaptive pass threshold from library spread (handoff §9).
 * spread = median template-vs-neutral matchScore distance 0..1.
 * Subtle movers (low spread) get a LOWER bar; dramatic movers get a
 * stricter bar. Clamped to [0.62, 0.8]. */
export function adaptiveThreshold(templates: PoseTemplate[], neutralBox: SamBox): number {
  if (templates.length === 0 || !neutralBox) return 0.72;
  const spread = medianTemplateSpread(templates, neutralBox);
  return Math.min(0.8, Math.max(0.62, 0.72 - (spread - 0.5) * 0.2));
}

/** Median 1-matchScore of each template vs the neutral pose (0..1 spread). */
export function medianTemplateSpread(templates: PoseTemplate[], neutralBox: SamBox): number {
  if (templates.length === 0) return 0.5;
  const dists = templates.map(t => {
    const self: MatchBreakdown = {
      signatureScore: Math.min(1, Math.max(0, 1 - (Math.abs(t.relCx) * 0.15 + Math.abs(t.relCy) * 0.15 + Math.abs(t.relArea - 1) * 0.25 + Math.abs(t.relAspect - 1) * 0.2 + Math.abs(t.relTop) * 0.15 + Math.abs(t.relHeight - 1) * 0.1))),
      gridScore: 0.5,
      markerScore: 0.5,
      total: 0,
    };
    self.total = 0.45 * self.signatureScore + 0.45 * self.gridScore + 0.1 * self.markerScore;
    return Math.min(1, Math.max(0, 1 - self.total));
  });
  const s = [...dists].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0.5;
}

export function emptyLibrary(mode: string, neutralBox: SamBox, leftIsImageRight: boolean, framing: string): PoseLibrary {
  const ng = gridFromBox(neutralBox);
  return {
    version: 1, mode, updatedAt: Date.now(),
    neutralBox, neutralGrid: [...ng.cells], leftIsImageRight, framing,
    passThreshold: 0.72, templates: {},
  };
}

export async function savePoseLibrary(lib: PoseLibrary): Promise<void> {
  try {
    await AsyncStorage.setItem(libKeyFor(lib.mode), JSON.stringify({ ...lib, updatedAt: Date.now() }));
  } catch { /* ignore */ }
}

export async function loadPoseLibrary(mode: string): Promise<PoseLibrary | null> {
  try {
    const raw = await AsyncStorage.getItem(libKeyFor(mode));
    if (!raw) return null;
    const p = JSON.parse(raw) as PoseLibrary;
    if (p.version !== 1 || !p.neutralBox || typeof p.templates !== 'object') return null;
    if (typeof p.passThreshold !== 'number') p.passThreshold = 0.72;
    return p;
  } catch {
    return null;
  }
}

export async function clearPoseLibrary(mode: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(libKeyFor(mode));
  } catch { /* ignore */ }
}
