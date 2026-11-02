import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Image,
  TextInput,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useHomeKey } from '../intelligence/useHomeKey';

export default function HomeScreen() {
  const navigation = useNavigation<any>();
  const { saved, masked, input, setInput, save, clear, refresh } = useHomeKey();
  const [editing, setEditing] = useState(false);
  useFocusEffect(
    React.useCallback(() => { refresh(); }, []),
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* Content — compact, fits without scrolling */}
      <View style={styles.content}>
        <View style={styles.poster}>
          <View style={styles.posterBand}>
            <Text style={styles.posterTop}>★ SIMON SAYS ★</Text>
          </View>
          <Image
            source={require('../../assets/simona.png')}
            style={styles.heroImage}
            resizeMode="contain"
          />
          <View style={styles.posterBand}>
            <Text style={styles.posterBottom}>PICK YOUR MODE</Text>
          </View>
          <View style={styles.posterRule} />
        </View>

        <TouchableOpacity
          style={[styles.vsButton, styles.easyRow]}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('Game', { mode: 'easy', voice: 'female' })}
        >
          <Text style={styles.vsEmoji}>🌱</Text>
          <View style={styles.vsTextWrap}>
            <Text style={styles.vsTitleLight}>Easy Mode</Text>
            <Text style={styles.vsSubLight}>Upper body</Text>
          </View>
          <Text style={styles.vsArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.vsButton, styles.hardRow]}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('Game', { mode: 'hard', voice: 'male' })}
        >
          <Text style={styles.vsEmoji}>🔥</Text>
          <View style={styles.vsTextWrap}>
            <Text style={styles.vsTitleLight}>Hard Mode</Text>
            <Text style={styles.vsSubLight}>Full body</Text>
          </View>
          <Text style={styles.vsArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.vsButton}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('Lobby')}
        >
          <Text style={styles.vsEmoji}>⚔️</Text>
          <View style={styles.vsTextWrap}>
            <Text style={styles.vsTitle}>VS Mode · Online Challenge</Text>
            <Text style={styles.vsSub}>Challenge others — challenger picks Easy or Hard</Text>
          </View>
          <Text style={styles.vsArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.vsButton, styles.bootButton]}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('Game', { mode: 'bootcamp', voice: 'male' })}
        >
          <Text style={styles.vsEmoji}>🪖</Text>
          <View style={styles.vsTextWrap}>
            <Text style={styles.vsTitle}>Bootcamp · Floor + Cardio</Text>
            <Text style={styles.vsSub}>Push-ups · planks · burpees · jump up</Text>
          </View>
          <Text style={styles.vsArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.vsButton, styles.kidsButton]}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('Game', { mode: 'kids', voice: 'female' })}
        >
          <Text style={styles.vsEmoji}>🧒</Text>
          <View style={styles.vsTextWrap}>
            <Text style={styles.vsTitle}>Kids Mode · Adaptive pace</Text>
            <Text style={styles.vsSub}>No tricks · always Simon says · speed follows you</Text>
          </View>
          <Text style={styles.vsArrow}>›</Text>
        </TouchableOpacity>

        {/* Homepage key panel: masked status only — full key never rendered.
            Same SAM key powers silhouette checks + Spark coach tips. */}
        <View style={styles.keyPanel}>
          {editing ? (
            <>
              <TextInput
                style={styles.keyInput}
                placeholder="Paste Meta Model API key"
                placeholderTextColor="#94a3b8"
                value={input}
                onChangeText={setInput}
                autoCapitalize="none"
                secureTextEntry
              />
              <View style={styles.keyRow}>
                <TouchableOpacity
                  style={styles.keySave}
                  activeOpacity={0.85}
                  onPress={async () => { await save(input); setEditing(false); }}
                >
                  <Text style={styles.keySaveText}>Save</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setEditing(false)} activeOpacity={0.8}>
                  <Text style={styles.keyCancel}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <View style={styles.keyRow}>
              <Text style={styles.keyStatus}>{saved ? `🔑 Key saved ${masked}` : 'Enter Meta Model API Key'}</Text>
              <TouchableOpacity onPress={() => setEditing(true)} activeOpacity={0.8}>
                <Text style={styles.keyLink}>{saved ? 'Change' : 'Add key'}</Text>
              </TouchableOpacity>
              {saved ? (
                <TouchableOpacity onPress={clear} activeOpacity={0.8}>
                  <Text style={styles.keyLink}>Clear</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4F1E6',
    overflow: 'hidden',
  },
  // Decorative blobs for lively feel
  blobYellow: {
    position: 'absolute',
    width: 420,
    height: 420,
    borderRadius: 210,
    backgroundColor: '#FFE55C',
    top: -120,
    right: -140,
    opacity: 1,
  },
  blobPink: {
    position: 'absolute',
    width: 340,
    height: 340,
    borderRadius: 170,
    backgroundColor: '#FF6B9D',
    top: 40,
    left: -110,
    opacity: 0.95,
  },
  blobCyan: {
    position: 'absolute',
    width: 380,
    height: 380,
    borderRadius: 190,
    backgroundColor: '#00D9FF',
    bottom: -90,
    right: -70,
    opacity: 0.9,
  },
  blobLime: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: '#6BCB77',
    bottom: 120,
    left: -60,
    opacity: 0.85,
  },
  blobOrange: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: '#FF6B35',
    top: 260,
    right: 30,
    opacity: 0.7,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  heroImage: {
    width: 230,
    height: 190,
    borderTopWidth: 4,
    borderBottomWidth: 4,
    borderColor: '#1a1a2e',
  },
  poster: {
    alignItems: 'center',
    width: '100%',
    marginBottom: 4,
    borderWidth: 4,
    borderColor: '#1a1a2e',
    backgroundColor: '#F4F1E6',
  },
  posterBand: {
    width: '100%',
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    paddingVertical: 6,
  },
  posterTop: {
    color: '#F4F1E6',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 4,
  },
  posterBottom: {
    color: '#C0392B',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 4,
  },
  posterRule: {
    width: '100%',
    height: 6,
    backgroundColor: '#C0392B',
  },
  instruction: {
    marginTop: 14,
    fontSize: 20,
    fontWeight: '700',
    color: '#1a1a2e',
    textAlign: 'center',
    lineHeight: 28,
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderRadius: 20,
    overflow: 'hidden',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  playText: {
    fontSize: 28,
    fontWeight: '900',
    color: '#FF2E63',
    letterSpacing: 1.5,
  },
  hint: {
    marginTop: 18,
    fontSize: 14,
    fontWeight: '700',
    color: '#1a1a2e',
    opacity: 0.8,
  },
  modeRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'stretch',
    gap: 14,
    marginTop: 22,
    width: '100%',
  },
  modeButton: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 24,
    paddingVertical: 16,
    paddingHorizontal: 10,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    borderWidth: 4,
  },
  easyButton: {
    borderColor: '#6BCB77',
  },
  hardButton: {
    borderColor: '#FF2E63',
  },
  vsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginTop: 8,
    backgroundColor: '#1a1a2e',
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 14,
    elevation: 4,
    borderWidth: 3,
    borderColor: '#00D9FF',
  },
  easyRow: { borderColor: '#6BCB77' },
  hardRow: { borderColor: '#FF2E63' },
  vsTitleLight: { fontSize: 14, fontWeight: '900', color: '#fff' },
  vsSubLight: { fontSize: 11, fontWeight: '600', color: '#9CA3AF', marginTop: 1 },
  vsEmoji: { fontSize: 26 },
  vsTextWrap: { flex: 1, marginLeft: 10 },
  vsTitle: { fontSize: 14, fontWeight: '900', color: '#fff' },
  vsSub: { fontSize: 11, fontWeight: '600', color: '#9CA3AF', marginTop: 1 },
  vsArrow: { fontSize: 22, color: '#00D9FF', fontWeight: '900' },
  bootButton: { borderColor: '#1a1a2e' },
  kidsButton: { borderColor: '#FF6B9D' },
  modeImage: {
    width: 110,
    height: 110,
  },
  modeLabel: {
    marginTop: 10,
    fontSize: 17,
    fontWeight: '900',
    color: '#1a1a2e',
    letterSpacing: 0.5,
  },
  voiceLabel: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '700',
    color: '#6b7280',
  },
  footer: {
    marginTop: 8,
    fontSize: 11,
    fontWeight: '700',
    color: '#1a1a2e',
    opacity: 0.6,
    letterSpacing: 1,
  },
  rigLink: {
    marginTop: 8,
    backgroundColor: '#1a1a2e',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
  },
  rigLinkText: {
    color: '#FFD93D',
    fontWeight: '900',
    fontSize: 11,
  },
  keyPanel: {
    width: '100%',
    marginTop: 8,
    backgroundColor: '#1a1a2e',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 2,
    borderColor: '#00D9FF',
  },
  keyRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  keyStatus: { flex: 1, color: '#e2e8f0', fontWeight: '700', fontSize: 12 },
  keyLink: { color: '#00D9FF', fontWeight: '900', fontSize: 12 },
  keyInput: { backgroundColor: '#0f172a', color: '#fff', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: '#334155', fontSize: 13 },
  keySave: { backgroundColor: '#6BCB77', paddingHorizontal: 18, paddingVertical: 8, borderRadius: 999, marginTop: 8 },
  keySaveText: { color: '#0f172a', fontWeight: '900', fontSize: 13 },
  keyCancel: { color: '#94a3b8', fontWeight: '800', fontSize: 12, marginTop: 8 },
});
