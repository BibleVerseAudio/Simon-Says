/**
 * SAM 3.1 verifier — typed, fail-safe, testable.
 *
 * SAM is an ANY-MOVEMENT segmenter here, not a pose/action recogniser:
 * it returns person boxes per frame; the game scores HOW MUCH the box
 * changed (move vs still) and HOW it moved (smooth vs flail).
 *
 * Verdicts: PASS | FAIL_MOVE | UNVERIFIED.
 * - PASS: proven movement matching the expected command.
 * - FAIL_MOVE: proven wrong behaviour (no move on Simon-says, move on trap).
 * - UNVERIFIED: camera/network/API fault — pause & retry, never a loss.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const SAM_URL = 'https://api.meta.ai/v1/responses';
const KEY_STORAGE = 'simonsays.sam.key.v1';
const KEY_TIMEOUT_MS = 15000;

export interface SamBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  w: number;
  h: number;
  confidence?: number;
}

export type VerdictKind = 'PASS' | 'FAIL_MOVE' | 'UNVERIFIED';

export interface MoveVerdict {
  kind: VerdictKind;
  reason: string;
  box: SamBox | null;
  grow: number;
  shift: number;
  unverifiedStreak: number;
}

export type SamStatus = 'idle' | 'scanning' | 'locked' | 'unavailable';

/* ---------- key storage (persisted, not a JS global) ---------- */

let keyCache: string | null = null;
let keyLoaded = false;

export async function loadSamKey(): Promise<string> {
  if (keyLoaded) return keyCache ?? '';
  keyLoaded = true;
  try {
    keyCache = (await AsyncStorage.getItem(KEY_STORAGE)) ?? '';
  } catch {
    keyCache = '';
  }
  return keyCache ?? '';
}

export async function saveSamKey(key: string): Promise<void> {
  keyCache = key.trim();
  keyLoaded = true;
  try {
    await AsyncStorage.setItem(KEY_STORAGE, keyCache);
  } catch {
    /* ignore */
  }
}

export function getSamKeySync(): string {
  return keyCache ?? '';
}

/** Back-compat shims for old callers. */
export function setSamApiKey(key: string): void {
  keyCache = (key ?? '').trim();
  keyLoaded = true;
  AsyncStorage.setItem(KEY_STORAGE, keyCache).catch(() => {});
}

function getApiKey(): string {
  return keyCache ?? '';
}

/* ---------- wire parsing ---------- */

const BOX_RE =
  /<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)(?:;c=([\d.]+))?\|>/g;

export function parseSamBoxes(text: string): SamBox[] {
  const out: SamBox[] = [];
  BOX_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BOX_RE.exec(text)) !== null) {
    out.push({
      x1: Number(m[1]),
      y1: Number(m[2]),
      x2: Number(m[3]),
      y2: Number(m[4]),
      w: Number(m[5]) || 1,
      h: Number(m[6]) || 1,
      confidence: m[7] != null ? Number(m[7]) : undefined,
    });
  }
  return out;
}

/** Legacy single-box parse (first match) — prefer parseSamBoxes + pickBox. */
export function parseSamBox(text: string): SamBox | null {
  return parseSamBoxes(text)[0] ?? null;
}

function boxArea(b: SamBox): number {
  return Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
}

function boxCenter(b: SamBox): { cx: number; cy: number } {
  return { cx: (b.x1 + b.x2) / 2 / b.w, cy: (b.y1 + b.y2) / 2 / b.h };
}

function iou(a: SamBox, b: SamBox): number {  const ix1 = Math.max(a.x1, b.x1);
  const iy1 = Math.max(a.y1, b.y1);
  const ix2 = Math.min(a.x2, b.x2);
  const iy2 = Math.min(a.y2, b.y2);
  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  const union = boxArea(a) + boxArea(b) - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Pick the box that is most likely THE player: best IoU continuity with the
 * reference frame, tie-broken by largest area. Returns null on ambiguity
 * (two+ strong matches) so the caller reports UNVERIFIED, not a guess.
 */
export function pickBox(boxes: SamBox[], ref: SamBox | null): SamBox | null {
  if (boxes.length === 0) return null;
  if (boxes.length === 1) return boxes[0];
  if (!ref) {
    const sorted = [...boxes].sort((a, b) => boxArea(b) - boxArea(a));
    if (sorted.length > 1 && boxArea(sorted[1]) > boxArea(sorted[0]) * 0.85) return null;
    return sorted[0];
  }
  const scored = boxes
    .map(b => ({ b, s: iou(b, ref) + (b.confidence ?? 0.5) * 0.1 }))
    .sort((a, b) => b.s - a.s);
  if (scored.length > 1 && scored[0].s - scored[1].s < 0.05) return null;
  return scored[0].b;
}

/* ---------- expectations ---------- */

function expectationFor(
  commandId: string,
  forgiving = false,
  scale = 1,
): { label: string; minGrow: number; minShift: number } {
  const k = (forgiving ? 0.25 : 1) * (Number.isFinite(scale) && scale > 0 ? scale : 1);
  if (/jump_once|spin_around|do_a_squat|touch_your_toes/.test(commandId)) {
    return { label: 'big move', minGrow: 0.12 * k, minShift: 0.04 * k };
  }
  if (/march_in_place|step_|lift_your|stomp_|stand_on|bend_your|twist|kick_|take_two/.test(commandId)) {
    return { label: 'leg move', minGrow: 0.06 * k, minShift: 0.03 * k };
  }
  if (/raise_both_hands|make_an_x_sign/.test(commandId)) {
    return { label: 'arms up', minGrow: 0.08 * k, minShift: 0.02 * k };
  }
  return { label: 'upper move', minGrow: 0.03 * k, minShift: 0.015 * k };
}

/* ---------- jerk (kept, frame-processor-free) ---------- */

export function scoreJerk(
  pts: { x: number; y: number }[],
  dt = 0.4,
): { jerk: number; smoothness: 'smooth' | 'firm' | 'jerky' } {
  if (pts.length < 3 || dt <= 0) return { jerk: 0, smoothness: 'smooth' };
  const vels: { x: number; y: number }[] = [];
  for (let i = 1; i < pts.length; i++) {
    vels.push({ x: (pts[i].x - pts[i - 1].x) / dt, y: (pts[i].y - pts[i - 1].y) / dt });
  }
  const speeds = vels.map(v => Math.hypot(v.x, v.y));
  const mean = speeds.reduce((a, b) => a + b, 0) / Math.max(1, speeds.length);
  if (mean < 1e-6) return { jerk: 0, smoothness: 'smooth' };
  let reversals = 0;
  for (let i = 1; i < vels.length; i++) {
    const dot = vels[i].x * vels[i - 1].x + vels[i].y * vels[i - 1].y;
    const m1 = Math.hypot(vels[i - 1].x, vels[i - 1].y);
    const m2 = Math.hypot(vels[i].x, vels[i].y);
    if (m1 > 1e-6 && m2 > 1e-6 && dot / (m1 * m2) < -0.2) reversals++;
  }
  let spikes = 0;
  for (let i = 1; i < speeds.length; i++) {
    if (Math.abs(speeds[i] - speeds[i - 1]) > mean * 3) spikes++;
  }
  const steps = Math.max(1, pts.length - 1);
  const jerkRaw = Math.min(1, (reversals / steps) * 0.7 + (spikes / steps) * 0.6);
  const energy = Math.min(1, mean / 0.35);
  const jerk = jerkRaw * (0.35 + 0.65 * energy);
  return { jerk, smoothness: jerk < 0.3 ? 'smooth' : jerk < 0.6 ? 'firm' : 'jerky' };
}

/* ---------- API ---------- */

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export class SamError extends Error {
  code: 'no-key' | 'http' | 'network' | 'parse';
  status?: number;
  constructor(code: SamError['code'], message: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function segmentPerson(
  base64Jpeg: string,
  timeoutMs = KEY_TIMEOUT_MS,
): Promise<{ text: string }> {
  const apiKey = getApiKey();
  if (!apiKey) throw new SamError('no-key', 'no-key');
  let res: Response;
  try {
    res = await fetchWithTimeout(
      SAM_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'sam-3.1',
          stream: false,
          metadata: { include_confidence: 'true', mask_encoding: 'one_bit' },
          input: [
            {
              type: 'message',
              role: 'user',
              content: [
                { type: 'input_text', text: 'person' },
                { type: 'input_image', image_url: `data:image/jpeg;base64,${base64Jpeg}` },
              ],
            },
          ],
        }),
      },
      timeoutMs,
    );
  } catch (e: any) {
    throw new SamError('network', e?.name === 'AbortError' ? 'timeout' : String(e?.message ?? e));
  }
  if (!res.ok) throw new SamError('http', `sam-${res.status}`, res.status);
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    throw new SamError('parse', 'bad-json');
  }
  let text = '';
  try {
    for (const item of data.output ?? []) {
      for (const c of item.content ?? []) {
        if (typeof c.text === 'string') text += c.text;
        else if (typeof c.output_text === 'string') text += c.output_text;
      }
    }
    if (!text && typeof data.output_text === 'string') text = data.output_text;
  } catch {
    text = '';
  }
  return { text };
}

/* ---------- verdicts ---------- */

export type Expected = 'move' | 'freeze';

/**
 * UNVERIFIED policy (immediate-pause): every UNVERIFIED result pauses with
 * tap-to-resume instead of advancing or counting a strike. Budget of 1 —
 * the FIRST unverified check pauses. Proven verdicts reset the streak.
 */
export const UNVERIFIED_BUDGET = 1;

export function shouldPauseOnUnverified(streak: number): boolean {
  return streak >= UNVERIFIED_BUDGET;
}

/**
 * Verdict + countdown display copy for the pause overlay so rules cannot drift.
 */
export function unverifiedCopy(streak: number): string {
  return `⏸️ ${streak}/${UNVERIFIED_BUDGET} — tap resume to retry`;
}

/**
 * True median-agreement baseline: component-wise median of all agreeing
 * samples (not just the first pair). Rejects mid-motion outliers: samples
 * that disagree with the median by IoU<0.4 are dropped before locking.
 */
export function medianBaseline(samples: SamBox[]): SamBox | null {
  if (samples.length === 0) return null;
  if (samples.length === 1) return null; // need agreement, not a single frame
  const med = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const w = med(samples.map(s => s.w));
  const h = med(samples.map(s => s.h));
  const cand: SamBox = {
    x1: med(samples.map(s => s.x1)),
    y1: med(samples.map(s => s.y1)),
    x2: med(samples.map(s => s.x2)),
    y2: med(samples.map(s => s.y2)),
    w: w || 1,
    h: h || 1,
  };
  const agreeing = samples.filter(s => iou(s, cand) > 0.4);
  if (agreeing.length < 2) return null;
  if (agreeing.length < samples.length) return medianBaseline(agreeing);
  return cand;
}

/**
 * Core rule:
 * - expected 'move' (Simon says): PASS iff box delta clears thresholds.
 * - expected 'freeze' (bare trap): PASS iff box stays UNDER thresholds.
 * Null boxes → UNVERIFIED (service/camera fault, never a loss).
 */
export function judgeMove(
  commandId: string,
  expected: Expected,
  ref: SamBox | null,
  now: SamBox | null,
  forgiving = false,
  jerk: number | null = null,
  // Personal scale from the calibration profile (Wonder): subtle movers get
  // proportionally lower thresholds. Defaults to 1 = global tables.
  scale = 1,
): MoveVerdict {
  if (!ref || !now) {
    return {
      kind: forgiving ? 'PASS' : 'UNVERIFIED',
      reason: !ref && !now ? 'no camera reading' : !ref ? 'no baseline — hold still in get-ready' : 'no silhouette found — stay in frame',
      box: now,
      grow: 0,
      shift: 0,
      unverifiedStreak: 1,
    };
  }
  const exp = expectationFor(commandId, forgiving, scale);
  const area0 = boxArea(ref);
  const grow = area0 > 0 ? Math.abs(boxArea(now) - area0) / area0 : 0;
  const c0 = boxCenter(ref);
  const c1 = boxCenter(now);
  const shift = Math.hypot(c1.cx - c0.cx, c1.cy - c0.cy);
  const moved = grow >= exp.minGrow || shift >= exp.minShift;
  const detail = `${exp.label} grow ${(grow * 100).toFixed(0)}%/shift ${(shift * 100).toFixed(1)}%`;
  const smoothness = jerk == null || forgiving ? null : jerk < 0.3 ? 'smooth' : jerk < 0.6 ? 'firm' : 'jerky';
  if (expected === 'move') {
    if (smoothness === 'jerky' && !forgiving) {
      return { kind: 'FAIL_MOVE', reason: `jerky flail (jerk ${(jerk! * 100).toFixed(0)}%) — do it smooth (${detail})`, box: now, grow, shift, unverifiedStreak: 0 };
    }
    return moved
      ? { kind: 'PASS', reason: `moved (${detail})`, box: now, grow, shift, unverifiedStreak: 0 }
      : { kind: forgiving ? 'PASS' : 'FAIL_MOVE', reason: `no move (${detail})`, box: now, grow, shift, unverifiedStreak: 0 };
  }
  return !moved
    ? { kind: 'PASS', reason: `held still (${detail})`, box: now, grow, shift, unverifiedStreak: 0 }
    : { kind: forgiving ? 'PASS' : 'FAIL_MOVE', reason: `moved without "Simon says"! (${detail})`, box: now, grow, shift, unverifiedStreak: 0 };
}

/** Legacy alias (silhouette-only, no expected semantics). */
export function judgeSilhouette(
  commandId: string,
  rest: SamBox | null,
  now: SamBox | null,
  forgiving = false,
): { ok: boolean; reason: string; box: SamBox | null; apiUsed: boolean } {
  const v = judgeMove(commandId, 'move', rest, now, forgiving);
  return { ok: v.kind === 'PASS', reason: v.reason, box: v.box, apiUsed: true };
}

/* ---------- verifier interface (fake for tests) ---------- */

export interface SamVerifier {
  check(expected: Expected, commandId: string, ref: SamBox | null, now: SamBox | null, forgiving: boolean, scale?: number): MoveVerdict;
}

export const realVerifier: SamVerifier = {
  check: (expected, commandId, ref, now, forgiving, scale = 1) => judgeMove(commandId, expected, ref, now, forgiving, null, scale),
};
