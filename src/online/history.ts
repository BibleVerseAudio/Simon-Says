import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'simonsays.history.v1';
const MAX_DAYS = 30;

export interface DayStat {
  date: string; // YYYY-MM-DD
  moves: number;
  kcal: number;
  seconds: number;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function logSession(moves: number, kcal: number, seconds: number): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const list: DayStat[] = raw ? JSON.parse(raw) : [];
    const t = today();
    const found = list.find(d => d.date === t);
    if (found) {
      found.moves += moves;
      found.kcal += kcal;
      found.seconds += seconds;
    } else {
      list.push({ date: t, moves, kcal, seconds });
    }
    await AsyncStorage.setItem(KEY, JSON.stringify(list.slice(-MAX_DAYS)));
  } catch { /* ignore */ }
}

/** Last 7 days, zero-filled, oldest → newest. */
export async function weekStats(): Promise<DayStat[]> {
  let list: DayStat[] = [];
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) list = JSON.parse(raw);
  } catch { /* ignore */ }
  const out: DayStat[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    out.push(list.find(x => x.date === key) ?? { date: key, moves: 0, kcal: 0, seconds: 0 });
  }
  return out;
}

export function weekday(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return ['S', 'M', 'T', 'W', 'T', 'F', 'S'][new Date(y, m - 1, d).getDay()];
}
