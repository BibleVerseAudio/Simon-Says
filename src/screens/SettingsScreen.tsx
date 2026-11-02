import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity } from 'react-native';
import { loadSamKey, saveSamKey } from '../sam/verifier';
import { sparkSmokeTest, type SparkSmokeResult } from '../intelligence/museSpark';

export default function SettingsScreen() {
  const [key, setKey] = useState('');
  const [saved, setSaved] = useState(false);
  // Wonder P0: live Spark proof runs HERE (dev/owner only) — real-key
  // model/source/latency recorded for the judging sheet before demo.
  const [smoke, setSmoke] = useState<SparkSmokeResult | null>(null);
  const [smoking, setSmoking] = useState(false);
  useEffect(() => {
    loadSamKey().then(k => { if (k) { setKey(k); setSaved(true); } });
  }, []);
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Settings</Text>
      <Text style={styles.text}>Meta Model API key (SAM 3.1 silhouette checks)</Text>
      <TextInput
        style={styles.input}
        placeholder="MODEL_API_KEY"
        placeholderTextColor="#64748b"
        value={key}
        onChangeText={setKey}
        autoCapitalize="none"
        secureTextEntry
      />
      <TouchableOpacity
        style={styles.save}
        activeOpacity={0.85}
        onPress={async () => { await saveSamKey(key.trim()); setSaved(key.trim().length > 0); }}
      >
        <Text style={styles.saveText}>{saved ? '✅ SAM key saved' : 'Save key'}</Text>
      </TouchableOpacity>
      <Text style={styles.hint}>SAM 3.1 verifies each move on-device snapshots sent to Meta Model API. No key = UNVERIFIED pause, never a loss. Key stays on this device.</Text>
      <TouchableOpacity
        style={styles.smoke}
        activeOpacity={0.85}
        disabled={smoking}
        onPress={async () => {
          setSmoking(true);
          try {
            setSmoke(await sparkSmokeTest());
          } finally {
            setSmoking(false);
          }
        }}
      >
        <Text style={styles.smokeText}>{smoking ? '⏳ testing Spark…' : '🧪 Test Spark 1.3 live'}</Text>
      </TouchableOpacity>
      {smoke ? (
        <Text style={styles.hint}>
          {smoke.ran ? (smoke.ok ? `✅ Spark live 1.3 · ${smoke.latencyMs}ms · ${smoke.source}` : `⚠️ Spark ${smoke.source} · ${smoke.latencyMs}ms`) : '🔑 no key — save a key first'}
          {smoke.feedback ? ` · "${smoke.feedback.slice(0, 60)}"` : ''}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#0f172a' },
  title: { fontSize: 24, fontWeight: '700', color: '#f8fafc', marginBottom: 12 },
  text: { color: '#94a3b8', marginBottom: 12, textAlign: 'center' },
  input: { width: '100%', backgroundColor: '#1e293b', color: '#fff', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: '#334155', marginBottom: 12 },
  save: { backgroundColor: '#6BCB77', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 999 },
  saveText: { color: '#0f172a', fontWeight: '900' },
  smoke: { marginTop: 12, backgroundColor: '#00D9FF', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 999 },
  smokeText: { color: '#0f172a', fontWeight: '900' },
  hint: { color: '#64748b', fontSize: 12, marginTop: 14, textAlign: 'center' },
});
