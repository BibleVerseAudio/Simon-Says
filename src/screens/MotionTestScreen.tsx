import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, useWindowDimensions } from 'react-native';
import { Camera, useCameraDevice, useCameraPermission, useFrameProcessor } from 'react-native-vision-camera';
import { useNavigation } from '@react-navigation/native';
import { useSharedValue, runOnJS } from 'react-native-reanimated';

type Verdict = 'CALIBRATING' | 'STILL' | 'SMOOTH' | 'JERK' | 'PHONE_SHAKE';

interface WpState {
  calibrating: boolean;
  calSum: number;
  calN: number;
  calStart: number;
  noiseFloor: number;
  prev: number | null;
  spikeTimes: number[];
}

/**
 * Phase 1 motion-meter harness.
 * Front camera, pixel-diff motion M(t) in a frame-processor worklet.
 * Calibration during countdown, then live verdict badge + motion graph.
 */
export default function MotionTestScreen() {
  const navigation = useNavigation();
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('front');
  const { width } = useWindowDimensions();

  const [motion, setMotion] = useState(0);
  const [verdict, setVerdict] = useState<Verdict>('CALIBRATING');
  const [noiseFloor, setNoiseFloor] = useState(0);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<number[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const wp = useSharedValue<WpState>({
    calibrating: true,
    calSum: 0,
    calN: 0,
    calStart: 0,
    noiseFloor: 2,
    prev: null,
    spikeTimes: [],
  });
  const motionJs = useSharedValue({ m: 0, cal: 0, verdict: 'CALIBRATING' });

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  const frameProcessor = useFrameProcessor(
    frame => {
      'worklet';
      const c = wp.value;
      const now = Date.now();
      try {
        const buf = frame.toArrayBuffer();
        const bytes = new Uint8Array(buf);
        const target = 4000;
        const step = Math.max(4, Math.floor(bytes.length / target));
        let acc = 0;
        let n = 0;
        for (let i = 0; i < bytes.length; i += step) {
          acc += bytes[i];
          n++;
        }
        const fingerprint = n > 0 ? acc / n : 0;
        if (c.prev == null) {
          c.prev = fingerprint;
          if (c.calStart === 0) c.calStart = now;
          return;
        }
        const diff = Math.abs(fingerprint - c.prev);
        c.prev = fingerprint;
        const m = Math.min(100, (diff / 255) * 100 * 4);
        if (c.calibrating) {
          c.calSum += m;
          c.calN += 1;
          if (now - c.calStart >= 3000) {
            c.noiseFloor = Math.max(1.5, (c.calSum / Math.max(1, c.calN)) * 2.5);
            c.calibrating = false;
          }
          motionJs.value = { m, cal: c.noiseFloor, verdict: 'CALIBRATING' };
          runOnJS(setMotion)(m);
          return;
        }
        const floor = c.noiseFloor;
        const stillTh = floor * 2.2;
        const spikeTh = floor * 6;
        let v = 'STILL';
        if (m > spikeTh) {
          if (m > floor * 14) {
            v = 'PHONE_SHAKE';
          } else {
            const recent = c.spikeTimes.filter((t: number) => now - t < 1500);
            recent.push(now);
            c.spikeTimes = recent;
            v = recent.length >= 2 ? 'JERK' : 'SMOOTH';
          }
        } else if (m > stillTh) {
          v = 'SMOOTH';
        }
        motionJs.value = { m, cal: floor, verdict: v };
        runOnJS(setMotion)(m);
      } catch {
        // skip unreadable frames
      }
    },
    [wp, motionJs],
  );

  const toggle = useCallback(() => setRunning(r => !r), []);

  useEffect(() => {
    if (!running) {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      return;
    }
    wp.value = {
      calibrating: true,
      calSum: 0,
      calN: 0,
      calStart: 0,
      noiseFloor: 2,
      prev: null,
      spikeTimes: [],
    };
    setHistory([]);
    setVerdict('CALIBRATING');
    pollRef.current = setInterval(() => {
      const s = { m: motionJs.value.m, cal: motionJs.value.cal, v: motionJs.value.verdict as Verdict };
      setVerdict(s.v);
      setNoiseFloor(s.cal);
      setHistory(prev => [...prev.slice(-60), s.m]);
    }, 150);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  const barColor =
    verdict === 'STILL'
      ? '#6BCB77'
      : verdict === 'SMOOTH'
        ? '#00D9FF'
        : verdict === 'JERK'
          ? '#FF2E63'
          : verdict === 'PHONE_SHAKE'
            ? '#FF9F1C'
            : '#9CA3AF';

  const maxH = 90;
  const peak = Math.max(20, ...history);

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Phase 1 · Motion Detector Rig</Text>
      <Text style={styles.sub}>Front camera · hold phone still during 3s calibration</Text>

      <View style={styles.previewWrap}>
        {device != null && hasPermission ? (
          <Camera
            style={styles.preview}
            device={device}
            isActive={running}
            frameProcessor={running ? frameProcessor : undefined}
            pixelFormat="yuv"
            photo={false}
            video={false}
            audio={false}
          />
        ) : (
          <View style={[styles.preview, styles.noCam]}>
            <Text style={styles.noCamText}>{hasPermission ? 'No front camera' : 'Requesting camera…'}</Text>
          </View>
        )}
        <View style={[styles.badge, { backgroundColor: barColor }]}>
          <Text style={styles.badgeText}>{running ? verdict : 'IDLE'}</Text>
        </View>
      </View>

      <View style={styles.meterWrap}>
        <Text style={styles.meterLabel}>
          Motion {motion.toFixed(1)} · floor {noiseFloor.toFixed(1)}
        </Text>
        <View style={styles.graph}>
          {history.map((v, i) => (
            <View
              key={i}
              style={[
                styles.graphBar,
                {
                  height: Math.max(2, (v / peak) * maxH),
                  backgroundColor: v > noiseFloor * 6 ? '#FF2E63' : v > noiseFloor * 2.2 ? '#00D9FF' : '#6BCB77',
                  width: Math.max(2, (width - 64) / 60 - 1),
                },
              ]}
            />
          ))}
        </View>
        <Text style={styles.legend}>green still · blue smooth · red jerk/shake</Text>
      </View>

      <View style={styles.row}>
        <TouchableOpacity style={[styles.btn, running ? styles.stop : styles.start]} onPress={toggle}>
          <Text style={styles.btnText}>{running ? '■ Stop sensor' : '▶ Start sensor'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, styles.back]} onPress={() => navigation.goBack()}>
          <Text style={styles.btnText}>← Back</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.hint}>Try: stay still · do the ear-touch · flinch on purpose · shake phone</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f172a', padding: 16, paddingTop: 48 },
  title: { fontSize: 20, fontWeight: '900', color: '#fff' },
  sub: { fontSize: 12, color: '#94a3b8', marginTop: 4, fontWeight: '600' },
  previewWrap: { marginTop: 14, borderRadius: 20, overflow: 'hidden', position: 'relative', backgroundColor: '#000', height: 300 },
  preview: { flex: 1 },
  noCam: { alignItems: 'center', justifyContent: 'center' },
  noCamText: { color: '#94a3b8', fontWeight: '700' },
  badge: { position: 'absolute', top: 12, left: 12, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999 },
  badgeText: { color: '#0f172a', fontWeight: '900', fontSize: 15, letterSpacing: 1 },
  meterWrap: { marginTop: 14, backgroundColor: '#1e293b', borderRadius: 16, padding: 12 },
  meterLabel: { color: '#e2e8f0', fontWeight: '800', fontSize: 13, marginBottom: 8 },
  graph: { flexDirection: 'row', alignItems: 'flex-end', height: 90, gap: 1 },
  graphBar: { borderRadius: 2 },
  legend: { color: '#64748b', fontSize: 11, marginTop: 8, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 10, marginTop: 14 },
  btn: { flex: 1, borderRadius: 16, paddingVertical: 14, alignItems: 'center' },
  start: { backgroundColor: '#6BCB77' },
  stop: { backgroundColor: '#FF2E63' },
  back: { backgroundColor: '#334155' },
  btnText: { color: '#fff', fontWeight: '900', fontSize: 15 },
  hint: { color: '#64748b', fontSize: 12, marginTop: 12, textAlign: 'center', fontWeight: '600' },
});
