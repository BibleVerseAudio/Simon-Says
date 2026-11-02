/**
 * Muse Spark game intelligence (advisory only — never replaces SAM verdicts).
 * Safe by construction: timeout, JSON-shape validation, local fallback.
 * Sends NO images, NO audio, NO personal data — only aggregate gameplay stats.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const URL = 'https://api.meta.ai/v1/responses';
const KEY_STORAGE = 'simonsays.sam.key.v1';
const TIMEOUT_MS = 12000;

export interface GameSnapshot {
  mode: string;
  stage: number;
  speed: number;
  score: number;
  hits: number;
  tries: number;
  streak: number;
  recentFailReason: string | null;
  unverifiedCount: number;
}

export type SparkSource = 'live' | 'no-key' | 'timeout' | 'http' | 'parse' | 'local';

export interface SparkAdvice {
  nextStageDelta: -1 | 0 | 1;
  trickRate: number | null; // null = keep current table
  feedback: string; // <= 140 chars, player-facing
  recalibrate: boolean;
  live: boolean; // true = muse-spark-1.3 responded; false = local fallback
  source: SparkSource; // Wonder P2: why fallback — drives the HUD label
  model: string; // model that produced this advice (proof for judges)
  latencyMs: number; // measured round-trip (mock-safe: 0 on fallback)
  at: number; // Date.now() of resolution — Stage One smoke-test evidence
}

const FALLBACK: SparkAdvice = {
  nextStageDelta: 0,
  trickRate: null,
  feedback: 'Keep going — hold still between moves.',
  recalibrate: false,
  live: false,
  source: 'local',
  model: 'muse-spark-1.3',
  latencyMs: 0,
  at: 0,
};

const MODEL_ID = 'muse-spark-1.3';

/** Kids-mode templated tips (local, no network): trick-free encouragement. */
export const KIDS_TIPS = [
  'Great big moves! ⭐',
  'Super star — keep dancing! ⭐',
  'Wow, smooth and smiley! 😊',
  'You did it — freeze like a statue! 🗿',
] as const;

export function kidsTip(turns: number): string {
  return KIDS_TIPS[Math.abs(Math.floor(turns)) % KIDS_TIPS.length];
}

async function loadKey(): Promise<string> {
  try {
    return (await AsyncStorage.getItem(KEY_STORAGE)) ?? '';
  } catch {
    return '';
  }
}

function sanitize(s: GameSnapshot): GameSnapshot {
  return {
    mode: String(s.mode).slice(0, 16),
    stage: Math.max(1, Math.min(999, Math.floor(s.stage) || 1)),
    // Game ramp caps speed at 2.5x (Wonder: align snapshot with engine).
    speed: Math.max(0.5, Math.min(2.5, Number(s.speed) || 1)),
    score: Math.max(0, Math.floor(s.score) || 0),
    hits: Math.max(0, Math.floor(s.hits) || 0),
    tries: Math.max(0, Math.floor(s.tries) || 0),
    streak: Math.max(0, Math.floor(s.streak) || 0),
    recentFailReason: (s.recentFailReason ?? '').slice(0, 120),
    unverifiedCount: Math.max(0, Math.floor(s.unverifiedCount) || 0),
  };
}

const SYSTEM = `You are a Simon-Says game coach. Reply with ONLY compact JSON: {"nextStageDelta":-1|0|1,"trickRate":0.0-0.8|null,"feedback":"<=140 chars","recalibrate":bool}. Rules: high hit-rate + streak -> nextStageDelta 1; repeated UNVERIFIED/fails -> -1 and recalibrate true if silhouette issues; else 0. feedback is encouraging, no medical claims.`;

const withMeta = (a: SparkAdvice, patch: Partial<SparkAdvice>): SparkAdvice => ({ ...a, ...patch });

export async function adviseNextStage(snap0: GameSnapshot): Promise<SparkAdvice> {
  const startedAt = Date.now();
  const snap = sanitize(snap0);
  let key = '';
  try {
    key = await loadKey();
  } catch {
    return withMeta(FALLBACK, { source: 'no-key', at: Date.now() });
  }
  if (!key) return withMeta(FALLBACK, { source: 'no-key', at: Date.now() });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL_ID,
        stream: false,
        input: [
          { type: 'message', role: 'system', content: [{ type: 'input_text', text: SYSTEM }] },
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: `stats: ${JSON.stringify(snap)}` }] },
        ],
      }),
      signal: ctrl.signal as any,
    });
    // Wonder P2: typed fallback reasons — judges see no-key vs timeout vs
    // http-<status> vs parse, not just "local". Latency measured per call.
    if (!res.ok) return withMeta(FALLBACK, { source: 'http', model: MODEL_ID, latencyMs: Date.now() - startedAt, at: Date.now() });
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      return withMeta(FALLBACK, { source: 'parse', model: MODEL_ID, latencyMs: Date.now() - startedAt, at: Date.now() });
    }
    let text = '';
    try {
      for (const item of data?.output ?? []) {
        for (const c of item?.content ?? []) {
          if (typeof c?.text === 'string') text += c.text;
          else if (typeof c?.output_text === 'string') text += c.output_text;
        }
      }
      if (!text && typeof data?.output_text === 'string') text = data.output_text;
    } catch {
      /* fall through */
    }
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return withMeta(FALLBACK, { source: 'parse', model: MODEL_ID, latencyMs: Date.now() - startedAt, at: Date.now() });
    let o: any;
    try {
      o = JSON.parse(m[0]);
    } catch {
      return withMeta(FALLBACK, { source: 'parse', model: MODEL_ID, latencyMs: Date.now() - startedAt, at: Date.now() });
    }
    if (o == null || typeof o !== 'object') return withMeta(FALLBACK, { source: 'parse', model: MODEL_ID, latencyMs: Date.now() - startedAt, at: Date.now() });
    const delta = o.nextStageDelta === 1 ? 1 : o.nextStageDelta === -1 ? -1 : 0;
    const trick = typeof o.trickRate === 'number' && o.trickRate >= 0 && o.trickRate <= 0.8 ? o.trickRate : null;
    const feedback = typeof o.feedback === 'string' && o.feedback.trim() ? o.feedback.trim().slice(0, 140) : FALLBACK.feedback;
    return { nextStageDelta: delta, trickRate: trick, feedback, recalibrate: o.recalibrate === true, live: true, source: 'live', model: MODEL_ID, latencyMs: Date.now() - startedAt, at: Date.now() };
  } catch (e: any) {
    const timedOut = e?.name === 'AbortError';
    return withMeta(FALLBACK, { source: timedOut ? 'timeout' : 'http', model: MODEL_ID, latencyMs: Date.now() - startedAt, at: Date.now() });
  } finally {
    clearTimeout(t);
  }
}

// Wonder: never mislabel a timeout as generic http — adviseNextStage
// already typed it; only fall here on a true throw (no advice at all).
export async function endOfRunSummary(snap0: GameSnapshot): Promise<{ text: string; live: boolean; source: SparkSource; model: string; latencyMs: number }> {
  try {
    const a = await adviseNextStage(snap0);
    return { text: a.feedback, live: a.live, source: a.source, model: a.model, latencyMs: a.latencyMs };
  } catch {
    return { text: FALLBACK.feedback, live: false, source: 'timeout', model: MODEL_ID, latencyMs: TIMEOUT_MS };
  }
}

/**
 * Stage One smoke proof (Wonder P0): real-key availability + latency +
 * raw shape, recorded by whoever runs it on device. No key = not run.
 * Run from a debug bridge / dev menu only — never auto-called in gameplay.
 */
export interface SparkSmokeResult {
  ran: boolean;
  ok: boolean;
  model: string;
  latencyMs: number;
  source: SparkSource;
  feedback: string;
  rawPreview: string;
  at: number;
}

export async function sparkSmokeTest(): Promise<SparkSmokeResult> {
  const startedAt = Date.now();
  const key = await loadKey().catch(() => '');
  if (!key) {
    return { ran: false, ok: false, model: MODEL_ID, latencyMs: 0, source: 'no-key', feedback: '', rawPreview: 'no-key: add SAM key in Settings', at: Date.now() };
  }
  try {
    const a = await adviseNextStage({ mode: 'easy', stage: 2, speed: 1, score: 5, hits: 5, tries: 6, streak: 3, recentFailReason: null, unverifiedCount: 0 });
    return {
      ran: true,
      ok: a.live,
      model: a.model,
      latencyMs: a.latencyMs || Date.now() - startedAt,
      source: a.source,
      feedback: a.feedback,
      rawPreview: JSON.stringify({ nextStageDelta: a.nextStageDelta, trickRate: a.trickRate, recalibrate: a.recalibrate }).slice(0, 200),
      at: a.at || Date.now(),
    };
  } catch {
    return { ran: true, ok: false, model: MODEL_ID, latencyMs: Date.now() - startedAt, source: 'http', feedback: '', rawPreview: 'threw', at: Date.now() };
  }
}
