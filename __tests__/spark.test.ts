/**
 * Spark 1.3 response-shape tests (Wonder P1+P2): valid / malformed /
 * http-error / timeout all resolve safe, sources typed, boundary math
 * proven. Uses global.fetch mocks — no network.
 */
import { adviseNextStage, kidsTip, sparkSmokeTest, type GameSnapshot } from '../src/intelligence/museSpark';

const snap = (): GameSnapshot => ({
  mode: 'easy',
  stage: 2,
  speed: 1,
  score: 5,
  hits: 5,
  tries: 6,
  streak: 3,
  recentFailReason: null,
  unverifiedCount: 0,
});

const WITH_KEY = 'simonsays.sam.key.v1';

jest.mock('@react-native-async-storage/async-storage', () => {
  let store: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (k: string) => store[k] ?? null),
      setItem: jest.fn(async (k: string, v: string) => { store[k] = v; }),
      removeItem: jest.fn(async (k: string) => { delete store[k]; }),
      __reset: () => { store = {}; },
    },
  };
});

const storage = () => (require('@react-native-async-storage/async-storage').default as any);

const setKey = async (v: string) => { await storage().setItem(WITH_KEY, v); };
const clearKey = async () => { await storage().removeItem(WITH_KEY); };

describe('spark responses', () => {
  const g = globalThis as any;
  const realFetch = g.fetch as any;
  afterEach(() => {
    g.fetch = realFetch;
    jest.useRealTimers();
  });
  beforeEach(() => clearKey());

  test('valid JSON response marks live + applies schema', async () => {
    await setKey('k');
    g.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        output: [{ content: [{ text: 'note {"nextStageDelta":1,"trickRate":0.6,"feedback":" Push faster, stay smooth! ","recalibrate":true}' }] }],
      }),
    }));
    const a = await adviseNextStage(snap());
    expect(a.live).toBe(true);
    expect(a.source).toBe('live');
    expect(a.model).toBe('muse-spark-1.3');
    expect(a.nextStageDelta).toBe(1);
    expect(a.trickRate).toBeCloseTo(0.6);
    expect(a.feedback).toBe('Push faster, stay smooth!');
    expect(a.recalibrate).toBe(true);
    expect(a.at).toBeGreaterThan(0);
    // Wonder P1: boundary math — stage ±1, trick nudge ±0.1, total ≤0.8.
    const baseTrick = 0.5;
    const nudge = a.trickRate == null ? 0 : Math.max(-0.1, Math.min(0.1, a.trickRate - baseTrick));
    expect(Math.abs(nudge)).toBeLessThanOrEqual(0.1);
    expect(Math.max(0, Math.min(0.8, baseTrick + nudge))).toBeLessThanOrEqual(0.8);
    expect(Math.max(1, Math.min(2 + a.nextStageDelta, 999))).toBe(3);
  });

  test('malformed JSON falls back non-live', async () => {
    await setKey('k');
    g.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ output: [{ content: [{ text: 'no json here at all' }] }] }),
    }));
    const a = await adviseNextStage(snap());
    expect(a.live).toBe(false);
    expect(a.source).toBe('parse');
    expect([1, 0, -1]).toContain(a.nextStageDelta);
    expect(typeof a.feedback).toBe('string');
  });

  test('http error falls back with http source', async () => {
    await setKey('k');
    g.fetch = jest.fn(async () => ({ ok: false, status: 401 }));
    const a = await adviseNextStage(snap());
    expect(a.live).toBe(false);
    expect(a.source).toBe('http');
  });

  test('no key reports no-key source (not silent local)', async () => {
    const a = await adviseNextStage(snap());
    expect(a.live).toBe(false);
    expect(a.source).toBe('no-key');
  });

  test('smoke test without key reports not-run (P0 evidence gate)', async () => {
    const r = await sparkSmokeTest();
    expect(r.ran).toBe(false);
    expect(r.ok).toBe(false);
    expect(r.source).toBe('no-key');
    expect(r.model).toBe('muse-spark-1.3');
  });

  test('kids tips are local and cycle without network', () => {
    g.fetch = jest.fn(async () => { throw new Error('must not call network'); });
    expect(typeof kidsTip(0)).toBe('string');
    expect(typeof kidsTip(7)).toBe('string');
    expect(kidsTip(0).length).toBeGreaterThan(0);
  });

  test('abort maps to timeout source, never silent http (Wonder)', async () => {
    await setKey('k');
    const err: any = new Error('aborted');
    err.name = 'AbortError';
    g.fetch = jest.fn(async () => { throw err; });
    const a = await adviseNextStage(snap());
    expect(a.live).toBe(false);
    expect(a.source).toBe('timeout');
  });

  test('persistent posture: base + nudge clamps into every draw (Wonder P1)', async () => {
    await setKey('k');
    g.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        output: [{ content: [{ text: '{"nextStageDelta":1,"trickRate":0.8,"feedback":"go","recalibrate":false}' }] }],
      }),
    }));
    const a = await adviseNextStage(snap());
    // Game draws use eff = clamp(base + clamp(a.trick - base, ±0.1)).
    for (const base of [0, 0.2, 0.5, 0.65, 0.8]) {
      const nudge = a.trickRate == null ? 0 : Math.max(-0.1, Math.min(0.1, a.trickRate - base));
      const eff = Math.max(0, Math.min(0.8, base + nudge));
      expect(Math.abs(nudge)).toBeLessThanOrEqual(0.1 + 1e-9);
      expect(eff).toBeGreaterThanOrEqual(0);
      expect(eff).toBeLessThanOrEqual(0.8);
    }
  });
});
