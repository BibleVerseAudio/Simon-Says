import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'simonsays.stars.v1';

export async function getStars(): Promise<number> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    const n = v == null ? 0 : parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

export async function addStar(): Promise<number> {
  const s = (await getStars()) + 1;
  try {
    await AsyncStorage.setItem(KEY, String(s));
  } catch { /* ignore */ }
  return s;
}

export async function loseStar(): Promise<number> {
  const s = Math.max(0, (await getStars()) - 1);
  try {
    await AsyncStorage.setItem(KEY, String(s));
  } catch { /* ignore */ }
  return s;
}
