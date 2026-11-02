import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, useWindowDimensions } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import Sound from 'react-native-sound';
import { addStar, getStars, loseStar } from '../online/stars';
import type { LobbyMode } from './LobbyScreen';

// Single shared knockout player (Wonder: was a new unreleased Sound per KO).
let koSound: Sound | null = null;
function playKnockout() {
  try {
    if (!koSound) koSound = new Sound('male_stomp_your_right_foot.mp3', Sound.MAIN_BUNDLE, () => {});
    koSound.stop(() => koSound?.play());
  } catch { /* ignore */ }
}

Sound.setCategory('Playback');

const BOT_NAMES = ['Ava', 'Kai', 'Zed', 'Mia', 'Leo', 'Nia', 'Rio', 'Sam'];
const ROUND_SECS = 30;

interface Cell {
  name: string;
  you: boolean;
  score: number;
  kcal: number;
  out: boolean;
}

function pickBots(): string[] {
  const pool = [...BOT_NAMES].sort(() => Math.random() - 0.5);
  return pool.slice(0, 3);
}

/**
 * 4-way online split: you (live selfie + audio) vs 3 simulated opponents.
 * Each tick every player gains 0-2 moves; a random player is eliminated
 * at 20s and 10s. Top scorer at 0s wins: +1⭐, losers −1⭐ (floor 0).
 * Real backend replaces the bot engine later — same screen, same rules.
 */
export default function OnlineMatchScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const lobbyMode: LobbyMode = route.params?.mode ?? 'easy';
  const duel = route.params?.duel as { code: string; mode: LobbyMode; target: number; from: string } | undefined;
  const isDuel = !!duel;
  const target = duel?.target ?? 0;
  const { width } = useWindowDimensions();
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('front');

  const [secs, setSecs] = useState(ROUND_SECS);
  const [cells, setCells] = useState<Cell[]>(() => [
    { name: 'YOU', you: true, score: 0, kcal: 0, out: false },
    ...pickBots().map(n => ({ name: n, you: false, score: 0, kcal: 0, out: false })),
  ]);
  const [over, setOver] = useState(false);
  const [stars, setStars] = useState(0);
  const [delta, setDelta] = useState<'win' | 'lose' | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  useEffect(() => {
    getStars().then(setStars);
  }, []);

  // Match engine: ONE interval for the whole match (Wonder: was recreated
  // every second on `secs` change). Single ticking clock, knockout schedule
  // by elapsed seconds — no stale-closure drift.
  useEffect(() => {
    if (over) return;
    let elapsed = ROUND_SECS - secs;
    const fired = new Set<number>();
    timer.current = setInterval(() => {
      elapsed += 1;
      setSecs(Math.max(0, ROUND_SECS - elapsed));
      if (elapsed >= ROUND_SECS) {
        if (timer.current) clearInterval(timer.current);
        setOver(true);
        return;
      }
      setCells(prev => {
        let next = prev.map(c =>
          c.out ? c : { ...c, score: c.score + Math.floor(Math.random() * 3), kcal: c.kcal + Math.random() * 0.5 },
        );
        // Eliminations at 10s and 20s ELAPSED (== 20s and 10s remaining).
        if ((elapsed === 10 || elapsed === 20) && !fired.has(elapsed)) {
          fired.add(elapsed);
          const alive = next.map((c, i) => ({ ...c, i })).filter(c => !c.out);
          if (alive.length > 2) {
            alive.sort((a, b) => a.score - b.score);
            const victim = Math.random() < 0.25 ? alive[Math.floor(Math.random() * alive.length)] : alive[0];
            next = next.map((c, i) => (i === victim.i ? { ...c, out: true } : c));
            playKnockout();
          }
        }
        return next;
      });
    }, 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [over]);

  // Settle stars once at match end.
  // Duel: beat the friend's target → +1⭐, else −1⭐. Quick: top scorer wins.
  useEffect(() => {
    if (!over || delta) return;
    const you = cells[0];
    const win = isDuel ? you.score >= target : (() => {
      const alive = cells.filter(c => !c.out);
      const top = Math.max(...alive.map(c => c.score));
      return !you.out && you.score >= top;
    })();
    (async () => {
      const s = win ? await addStar() : await loseStar();
      setStars(s);
      setDelta(win ? 'win' : 'lose');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [over]);

  const cellSize = (width - 48) / 2 - 6;
  const modeEmoji = lobbyMode === 'easy' ? '🌱' : lobbyMode === 'hard' ? '🔥' : '🪖';

  return (
    <View style={styles.root}>
      <Text style={styles.title}>
        {modeEmoji} {lobbyMode.toUpperCase()} · ⏱ {secs}s · ⭐ {stars}
      </Text>
      {isDuel ? (
        <View style={styles.duelBanner}>
          <Text style={styles.duelText}>🎟️ {duel!.code} · {duel!.from} set {target} moves — beat it!</Text>
        </View>
      ) : null}
      {over && delta ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            {delta === 'win' ? '🏆 YOU WIN! +1⭐' : '💔 You lose −1⭐ (min 0)'}
          </Text>
        </View>
      ) : null}
      <View style={styles.grid}>
        {cells.map((c, i) => (
          <View key={i} style={[styles.cell, { width: cellSize, height: cellSize }, c.out && styles.cellOut]}>
            {c.you && device != null && hasPermission ? (
              <Camera
                style={styles.selfie}
                device={device}
                isActive={!over}
                photo={false}
                video={false}
                audio={false}
              />
            ) : (
              <View style={styles.botFace}>
                <Text style={styles.botEmoji}>{c.out ? '💀' : '🙂'}</Text>
              </View>
            )}
            <View style={styles.tag}>
              <Text style={styles.tagText}>
                {c.you ? 'YOU' : c.name}
                {c.out ? ' · OUT' : ` · ${c.score} · 🔥${c.kcal.toFixed(1)}`}
              </Text>
            </View>
          </View>
        ))}
      </View>
      <Text style={styles.hint}>
        {over ? (isDuel ? (delta === 'win' ? `Target smashed (${target})!` : `Target was ${target} — train and retry.`) : 'Match over — stars settled.') : isDuel ? `Your moves: ${cells[0].score}/${target} (simulated scoring — real SAM duels coming)` : 'Top scorer at 0s wins · knockouts at 20s + 10s'}
      </Text>
      <TouchableOpacity style={styles.back} onPress={() => navigation.navigate('Main')} activeOpacity={0.8}>
        <Text style={styles.backText}>{over ? '← Lobby / Home' : 'Quit match'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f172a', padding: 16, paddingTop: 56 },
  title: { fontSize: 18, fontWeight: '900', color: '#fff' },
  banner: { marginTop: 10, backgroundColor: '#FFD93D', borderRadius: 16, padding: 12, alignItems: 'center' },
  bannerText: { fontSize: 16, fontWeight: '900', color: '#1a1a2e' },
  duelBanner: { marginTop: 10, backgroundColor: '#6BCB77', borderRadius: 16, padding: 12, alignItems: 'center' },
  duelText: { fontSize: 14, fontWeight: '900', color: '#0f172a' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 14 },
  cell: { borderRadius: 18, overflow: 'hidden', backgroundColor: '#1e293b', borderWidth: 3, borderColor: '#00D9FF', position: 'relative' },
  cellOut: { borderColor: '#475569', opacity: 0.6 },
  selfie: { flex: 1 },
  botFace: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#334155' },
  botEmoji: { fontSize: 54 },
  tag: { position: 'absolute', bottom: 8, left: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 999, paddingVertical: 5, alignItems: 'center' },
  tagText: { color: '#fff', fontWeight: '900', fontSize: 12 },
  hint: { color: '#64748b', fontSize: 12, textAlign: 'center', marginTop: 14, fontWeight: '600' },
  back: { marginTop: 14, backgroundColor: '#334155', paddingVertical: 14, borderRadius: 999, alignItems: 'center' },
  backText: { color: '#fff', fontWeight: '900' },
});
