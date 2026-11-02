/**
 * SAM signature game driver (wired into GameScreen burst loop via closure).
 * Kept separate so rules are unit-testable without the camera.
 */
import type { SamBox } from './verifier';
import { classifySign, signatureOf, type SignMatch } from './signatures';

export interface FrameSample {
  box: SamBox;
  sign: SignMatch | null;
  at: number;
}

export function signBetween(prev: SamBox, now: SamBox): SignMatch {
  return classifySign(prev, now);
}

export function signatureLabel(box: SamBox): string {
  const s = signatureOf(box);
  return `cx ${(s.cx * 100).toFixed(0)}% cy ${(s.cy * 100).toFixed(0)}% · area ${(s.area * 100).toFixed(0)}% · aspect ${s.aspect.toFixed(2)}`;
}
