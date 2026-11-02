import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, TextInput, Share } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { getStars } from '../online/stars';
import { createDuel, loadDuel } from '../online/duels';

export type LobbyMode = 'easy' | 'hard' | 'bootcamp';

const MODES: { id: LobbyMode; emoji: string; title: string; sub: string }[] = [
  { id: 'easy', emoji: '🌱', title: 'Easy', sub: 'Upper body' },
  { id: 'hard', emoji: '🔥', title: 'Hard', sub: 'Full body' },
  { id: 'bootcamp', emoji: '🪖', title: 'Bootcamp', sub: 'Floor + cardio' },
];

/**
 * Online lobby: pick a mode → waiting room → matched into a 4-way split.
 * v1: local matchmaking with simulated opponents (real backend later).
 * Stars persist on-device for now, online account later.
 */
export default function LobbyScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const [picked, setPicked] = useState<LobbyMode | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [dots, setDots] = useState('');
  const [stars, setStars] = useState(0);
  const [tab, setTab] = useState<'quick' | 'friend'>('quick');
  const [duelMode, setDuelMode] = useState<LobbyMode>('easy');
  const [target, setTarget] = useState('12');
  const [code, setCode] = useState('');
  const [made, setMade] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    getStars().then(setStars);
    const unsub = navigation.addListener('focus', () => getStars().then(setStars));
    return unsub;
  }, [navigation]);

  useEffect(() => {
    if (!waiting) return;
    const d = setInterval(() => setDots(s => (s.length >= 3 ? '' : s + '.')), 500);
    // Simulated matchmaking: 2.5s wait, then 4-way split.
    const m = setTimeout(() => {
      const mode = picked ?? 'easy';
      setWaiting(false);
      navigation.navigate('OnlineMatch', { mode });
    }, 2500);
    return () => {
      clearInterval(d);
      clearTimeout(m);
    };
  }, [waiting, picked, navigation]);

  useEffect(() => {
    if (route.params?.picked) {
      setPicked(route.params.picked);
      setWaiting(true);
    }
  }, [route.params]);

  return (
    <View style={styles.root}>
      <Text style={styles.title}>⚔️ Online Lobby</Text>
      <Text style={styles.stars}>⭐ {stars} star{stars === 1 ? '' : 's'}</Text>
      <Text style={styles.sub}>
        {waiting ? `Finding 3 players for ${picked}…${dots}` : 'Quick match or challenge a friend with a code'}
      </Text>

      <View style={styles.tabs}>
        <TouchableOpacity style={[styles.tab, tab === 'quick' && styles.tabOn]} onPress={() => setTab('quick')} activeOpacity={0.85}>
          <Text style={[styles.tabText, tab === 'quick' && styles.tabTextOn]}>⚡ Quick 4-way</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === 'friend' && styles.tabOn]} onPress={() => setTab('friend')} activeOpacity={0.85}>
          <Text style={[styles.tabText, tab === 'friend' && styles.tabTextOn]}>🧑‍🤝‍🧑 Friend duel</Text>
        </TouchableOpacity>
      </View>

      {tab === 'friend' && !waiting ? (
        <View style={styles.duelBox}>
          <Text style={styles.duelTitle}>Create a challenge</Text>
          <View style={styles.duelModes}>
            {MODES.map(m => (
              <TouchableOpacity key={m.id} style={[styles.duelMode, duelMode === m.id && styles.duelModeOn]} onPress={() => setDuelMode(m.id)} activeOpacity={0.85}>
                <Text style={styles.duelModeText}>{m.emoji}</Text>
              </TouchableOpacity>
            ))}
            <TextInput style={styles.target} value={target} onChangeText={setTarget} keyboardType="number-pad" maxLength={3} placeholder="12" placeholderTextColor="#64748b" />
            <Text style={styles.targetLabel}>moves</Text>
          </View>
          <TouchableOpacity
            style={styles.shareBtn}
            activeOpacity={0.85}
            onPress={async () => {
              const t = Math.max(1, parseInt(target || '12', 10) || 12);
              const d = await createDuel(duelMode, t, 0);
              setMade(d.code);
              setErr('');
              try {
                await Share.share({ message: `Beat me in Simon Says ${duelMode}! Code ${d.code} — ${t} moves. Enter it in VS → Friend duel.` });
              } catch { /* dismissed */ }
            }}
          >
            <Text style={styles.shareText}>🎟️ Make code + share</Text>
          </TouchableOpacity>
          {made ? <Text style={styles.madeCode}>Your code: {made}</Text> : null}
          <Text style={styles.duelTitle}>…or enter a friend's code</Text>
          <View style={styles.joinRow}>
            <TextInput style={styles.codeInput} value={code} onChangeText={v => setCode(v.toUpperCase())} autoCapitalize="characters" maxLength={6} placeholder="ABC123" placeholderTextColor="#64748b" />
            <TouchableOpacity
              style={styles.joinBtn}
              activeOpacity={0.85}
              onPress={async () => {
                const d = await loadDuel(code);
                if (!d) { setErr('Code not found on this device — ask for a fresh one.'); return; }
                setErr('');
                navigation.navigate('OnlineMatch', { mode: d.mode, duel: d });
              }}
            >
              <Text style={styles.joinText}>Join ▶</Text>
            </TouchableOpacity>
          </View>
          {err ? <Text style={styles.err}>{err}</Text> : null}
          <Text style={styles.note}>Async duel: play {duelMode} solo, beat the target — winner takes ⭐. Codes live on-device v1 (share via any app).</Text>
        </View>
      ) : null}

      {tab === 'quick' && waiting ? (
        <View style={styles.waitBox}>
          <ActivityIndicator size="large" color="#00D9FF" />
          <Text style={styles.waitText}>Matching {picked} players…</Text>
          <TouchableOpacity style={styles.cancel} onPress={() => setWaiting(false)} activeOpacity={0.85}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      ) : tab === 'quick' ? (
        MODES.map(m => (
          <TouchableOpacity
            key={m.id}
            style={[styles.card, picked === m.id && styles.cardActive]}
            activeOpacity={0.85}
            onPress={() => {
              setPicked(m.id);
              setWaiting(true);
            }}
          >
            <Text style={styles.emoji}>{m.emoji}</Text>
            <View style={styles.cardText}>
              <Text style={styles.cardTitle}>{m.title}</Text>
              <Text style={styles.cardSub}>{m.sub}</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>
        ))
      ) : null}

      <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()} activeOpacity={0.8}>
        <Text style={styles.backText}>← Back to Home</Text>
      </TouchableOpacity>
      <Text style={styles.note}>Winner +1⭐ · losers −1⭐ (floor 0) · v1 opponents simulated</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f172a', padding: 20, paddingTop: 56 },
  title: { fontSize: 26, fontWeight: '900', color: '#fff' },
  stars: { fontSize: 18, fontWeight: '900', color: '#FFD93D', marginTop: 6 },
  sub: { fontSize: 13, color: '#94a3b8', fontWeight: '600', marginTop: 6, marginBottom: 18 },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1e293b', borderRadius: 20, padding: 18, marginBottom: 12, borderWidth: 2, borderColor: '#334155' },
  cardActive: { borderColor: '#00D9FF' },
  emoji: { fontSize: 32 },
  cardText: { flex: 1, marginLeft: 14 },
  cardTitle: { fontSize: 18, fontWeight: '900', color: '#fff' },
  cardSub: { fontSize: 12, color: '#94a3b8', fontWeight: '600', marginTop: 2 },
  arrow: { fontSize: 26, color: '#00D9FF', fontWeight: '900' },
  tabs: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  tab: { flex: 1, backgroundColor: '#1e293b', borderRadius: 999, paddingVertical: 12, alignItems: 'center', borderWidth: 2, borderColor: '#334155' },
  tabOn: { borderColor: '#00D9FF', backgroundColor: '#0c2a3a' },
  tabText: { color: '#94a3b8', fontWeight: '900', fontSize: 14 },
  tabTextOn: { color: '#fff' },
  duelBox: { backgroundColor: '#1e293b', borderRadius: 20, padding: 16, borderWidth: 2, borderColor: '#6BCB77', marginBottom: 12 },
  duelTitle: { color: '#fff', fontWeight: '900', fontSize: 14, marginTop: 10, marginBottom: 8 },
  duelModes: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  duelMode: { width: 48, height: 48, borderRadius: 14, backgroundColor: '#0f172a', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#334155' },
  duelModeOn: { borderColor: '#6BCB77' },
  duelModeText: { fontSize: 24 },
  target: { flex: 1, backgroundColor: '#0f172a', color: '#fff', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, fontWeight: '900', textAlign: 'center', borderWidth: 1, borderColor: '#334155' },
  targetLabel: { color: '#94a3b8', fontWeight: '700' },
  shareBtn: { marginTop: 12, backgroundColor: '#6BCB77', borderRadius: 999, paddingVertical: 13, alignItems: 'center' },
  shareText: { color: '#0f172a', fontWeight: '900' },
  madeCode: { color: '#FFD93D', fontWeight: '900', fontSize: 20, textAlign: 'center', marginTop: 10, letterSpacing: 3 },
  joinRow: { flexDirection: 'row', gap: 10 },
  codeInput: { flex: 1, backgroundColor: '#0f172a', color: '#fff', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 18, fontWeight: '900', letterSpacing: 2, textAlign: 'center', borderWidth: 1, borderColor: '#334155' },
  joinBtn: { backgroundColor: '#00D9FF', borderRadius: 12, paddingHorizontal: 20, justifyContent: 'center' },
  joinText: { color: '#0f172a', fontWeight: '900' },
  err: { color: '#FF2E63', fontWeight: '700', fontSize: 12, marginTop: 8 },
  waitText: { color: '#e2e8f0', fontWeight: '800', marginTop: 14 },
  waitBox: { backgroundColor: '#1e293b', borderRadius: 20, padding: 28, alignItems: 'center', borderWidth: 2, borderColor: '#00D9FF' },
  cancel: { marginTop: 16, backgroundColor: '#334155', paddingHorizontal: 24, paddingVertical: 10, borderRadius: 999 },
  cancelText: { color: '#fff', fontWeight: '800' },
  back: { marginTop: 18, backgroundColor: '#334155', paddingVertical: 14, borderRadius: 999, alignItems: 'center' },
  backText: { color: '#fff', fontWeight: '900' },
  note: { color: '#64748b', fontSize: 11, textAlign: 'center', marginTop: 12, fontWeight: '600' },
});
