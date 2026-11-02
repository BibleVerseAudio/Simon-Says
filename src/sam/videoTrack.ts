import AsyncStorage from '@react-native-async-storage/async-storage';

import type { SamBox } from './verifier';

export interface VideoTrack {
  boxes: SamBox[];
  frames: number;
  ok: boolean;
  reason: string;
}

export async function trackBoxesSMTP(): Promise<VideoTrack | null> {
  return null;
}

/**
 * SAM video tracking via clip bursts.
 *
 * Game records a 2s clip at 240p/4fps, uploads once via Files API,
 * then tracks "person" across frames in ONE request. Boxes per frame
 * build a centroid path — smoother than still snapshots, and SAM keeps
 * identity so bystanders do not hijack the reference.
 *
 * Budget: ~$0.20/1k frames (docs). 8 frames/clip ≈ $0.002 per check.
 * Falls back to still-photo bursts when upload or tracking fails.
 */

export interface UploadedClip {
  fileId: string;
  frames: number;
  bytes: number;
}

export async function uploadClip(): Promise<UploadedClip | null> {
  return null;
}

export async function pollTrack(): Promise<VideoTrack | null> {
  return null;
}

export async function getTrackCached(): Promise<VideoTrack | null> {
  return null;
}

export async function putTrackCache(v: VideoTrack): Promise<void> {
  try { await AsyncStorage.setItem('simonsays.track.v1', JSON.stringify(v)); } catch { /* ignore */ }
}
export async function getTrackCache(): Promise<VideoTrack | null> {
  try {
    const raw = await AsyncStorage.getItem('simonsays.track.v1');
    return raw ? (JSON.parse(raw) as VideoTrack) : null;
  } catch { return null; }
}
export async function clearTrackCache(): Promise<void> {
  try { await AsyncStorage.removeItem('simonsays.track.v1'); } catch { /* ignore */ }
}
