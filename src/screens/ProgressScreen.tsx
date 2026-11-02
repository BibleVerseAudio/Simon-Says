import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, useWindowDimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { weekStats, weekday, type DayStat } from '../online/history';

function Bars({ data, max, color, fmt }: { data: DayStat[]; max: number; color: string; fmt: (d: DayStat) => string }) {
  const { width } = useWindowDimensions();
  const barW = Math.max(24, (width - 64) / 7 - 10);
  const H = 120;
  return (
    <View style={styles.bars}>
      {data.map((d, i) => (
        <View key={i} style={styles.col}>
          <Text style={styles.val}>{fmt(d)}</Text>
          <View style={[styles.track, { width: barW, height: H }]}>
            <View style={[styles.fill, { backgroundColor: color, width: barW, height: Math.max(3, max > 0 ? (barValue(d) / max) * H : 3) }]} />
          </View>
          <Text style={styles.day}>{weekday(d.date)}</Text>
        </View>
      ))}
    </View>
  );

  function barValue(d: DayStat) {
    return fmt === fmtKcal ? d.kcal : fmt === fmtMoves ? d.moves : d.seconds / 60;
  }
}

const fmtKcal = (d: DayStat) => (d.kcal >= 10 ? d.kcal.toFixed(0) : d.kcal.toFixed(1));
const fmtMoves = (d: DayStat) => `${d.moves}`;
const fmtMins = (d: DayStat) => `${Math.round(d.seconds / 60)}m`;

/**
 * Progress: 7-day kcal / moves / minutes bars. Proof-of-benefit for the pitch.
 */
export default function ProgressScreen() {
  const navigation = useNavigation();
  const [week, setWeek] = useState<DayStat[]>([]);
  const totals = week.reduce(
    (a, d) => ({ moves: a.moves + d.moves, kcal: a.kcal + d.kcal, secs: a.secs + d.seconds }),
    { moves: 0, kcal: 0, secs: 0 },
  );

  useEffect(() => {
    weekStats().then(setWeek);
    const unsub = navigation.addListener('focus', () => weekStats().then(setWeek));
    return unsub;
  }, [navigation]);

  const maxK = Math.max(1, ...week.map(d => d.kcal));
  const maxM = Math.max(1, ...week.map(d => d.moves));
  const maxT = Math.max(1, ...week.map(d => d.seconds / 60));

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.inner}>
      <Text style={styles.title}>📈 Progress</Text>
      <Text style={styles.sub}>Last 7 days · every finished level logs moves + kcal</Text>
      <View style={styles.totalRow}>
        <View style={styles.total}><Text style={styles.totalN}>🔥 {totals.kcal.toFixed(1)}</Text><Text style={styles.totalL}>kcal</Text></View>
        <View style={styles.total}><Text style={styles.totalN}>💪 {totals.moves}</Text><Text style={styles.totalL}>moves</Text></View>
        <View style={styles.total}><Text style={styles.totalN}>⏱ {Math.round(totals.secs / 60)}m</Text><Text style={styles.totalL}>active</Text></View>
      </View>
      <Text style={styles.h}>Calories per day</Text>
      <Bars data={week} max={maxK} color="#FF2E63" fmt={fmtKcal} />
      <Text style={styles.h}>Moves per day</Text>
      <Bars data={week} max={maxM} color="#00D9FF" fmt={fmtMoves} />
      <Text style={styles.h}>Active minutes</Text>
      <Bars data={week} max={maxT} color="#6BCB77" fmt={fmtMins} />
      <Text style={styles.foot}>Keep the streak alive — play a level every day 🔥</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f172a' },
  inner: { padding: 20, paddingTop: 56 },
  title: { fontSize: 26, fontWeight: '900', color: '#fff' },
  sub: { fontSize: 12, color: '#94a3b8', fontWeight: '600', marginTop: 4, marginBottom: 14 },
  totalRow: { flexDirection: 'row', gap: 10, marginBottom: 18 },
  total: { flex: 1, backgroundColor: '#1e293b', borderRadius: 16, padding: 12, alignItems: 'center' },
  totalN: { fontSize: 18, fontWeight: '900', color: '#fff' },
  totalL: { fontSize: 11, color: '#94a3b8', fontWeight: '700' },
  h: { fontSize: 15, fontWeight: '900', color: '#FFD93D', marginTop: 14, marginBottom: 6 },
  bars: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#1e293b', borderRadius: 16, padding: 12 },
  col: { alignItems: 'center', gap: 4 },
  val: { fontSize: 10, color: '#e2e8f0', fontWeight: '800' },
  track: { justifyContent: 'flex-end', backgroundColor: '#0f172a', borderRadius: 6, overflow: 'hidden' },
  fill: { borderRadius: 6 },
  day: { fontSize: 11, color: '#94a3b8', fontWeight: '800' },
  foot: { color: '#64748b', fontSize: 12, textAlign: 'center', marginTop: 18, fontWeight: '600' },
});
