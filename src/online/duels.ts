import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LobbyMode } from '../screens/LobbyScreen';

const PREFIX = 'simonsays.duel.';
const CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export interface Duel {
  code: string;
  mode: LobbyMode;
  target: number; // moves to beat
  kcal: number;
  from: string;
  createdAt: number;
}

export function makeCode(): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += CHARS[Math.floor(Math.random() * CHARS.length)];
  return s;
}

/** Challenger creates a duel from their finished score. Returns share code. */
export async function createDuel(mode: LobbyMode, target: number, kcal: number, from = 'YOU'): Promise<Duel> {
  const duel: Duel = { code: makeCode(), mode, target, kcal, from, createdAt: Date.now() };
  try {
    await AsyncStorage.setItem(PREFIX + duel.code, JSON.stringify(duel));
  } catch { /* ignore */ }
  return duel;
}

/** Friend enters a code to load the duel. Null when unknown/expired (>7d). */
export async function loadDuel(code: string): Promise<Duel | null> {
  const clean = code.trim().toUpperCase();
  if (!clean) return null;
  try {
    const raw = await AsyncStorage.getItem(PREFIX + clean);
    if (!raw) return null;
    const duel = JSON.parse(raw) as Duel;
    if (Date.now() - duel.createdAt > 7 * 24 * 3600 * 1000) return null;
    return duel;
  } catch {
    return null;
  }
}
