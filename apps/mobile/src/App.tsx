/**
 * Wisper Flow — Mobile App (React Native)
 *
 * Single screen, push-to-talk dictation with live refinement preview.
 * Shares the @wisper-flow/refinement engine with the desktop app.
 */
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, StyleSheet, Platform } from 'react-native';
import { refine } from '@wisper-flow/refinement';
import { useSettings } from './hooks/useSettings';
import { LLMClient } from './lib/llm';

export default function App() {
  const settings = useSettings();
  const llm = useRef(new LLMClient()).current;
  const [recording, setRecording] = useState(false);
  const [raw, setRaw] = useState('');
  const [refined, setRefined] = useState<any>(null);
  const [answer, setAnswer] = useState('');

  const toggle = async () => {
    if (recording) { setRecording(false); return; }
    setRecording(true); setRaw(''); setRefined(null); setAnswer('');
  };

  // Live refine as user types or after STT finalizes
  useEffect(() => {
    if (raw.length > 4) setRefined(refine(raw, { codingMode: settings.codingMode, mode: settings.mode }));
  }, [raw, settings.codingMode, settings.mode]);

  const sendToLLM = async () => {
    if (!refined) return;
    if (!settings.apiKey && settings.provider !== 'ollama') {
      setAnswer('No API key set. Open settings to add one.');
      return;
    }
    setAnswer('…thinking…');
    const out = await llm.stream(
      { llm: { provider: settings.provider, model: settings.model, apiKey: settings.apiKey } },
      refined.refinedPrompt,
      (chunk) => { setAnswer((a) => a === '…thinking…' ? chunk : a + chunk); },
    );
  };

  return (
    <ScrollView contentContainerStyle={s.root}>
      <Text style={s.title}>Wisper Flow</Text>
      <Text style={s.sub}>{Platform.OS === 'ios' ? 'iOS' : 'Android'} · {settings.provider}</Text>

      <View style={[s.mic, recording && s.micOn]}>
        <Pressable onPress={toggle} style={s.micBtn}>
          <Text style={s.micIcon}>{recording ? '⏹' : '🎙'}</Text>
        </Pressable>
        <Text style={s.micLabel}>{recording ? 'Listening… tap to stop' : 'Tap to dictate'}</Text>
      </View>

      <Text style={s.label}>Or type / paste transcript</Text>
      <TextInput
        style={s.box}
        value={raw}
        onChangeText={setRaw}
        multiline
        placeholder="um so like I want to write a function…"
      />

      {refined && (
        <View style={s.refinedBox}>
          <Text style={s.refinedHeader}>Refined · {refined.mode}{refined.language ? ` · ${refined.language}` : ''} · ~{refined.estimatedTokens} tok</Text>
          <Text style={s.refinedText}>{refined.refinedPrompt}</Text>
        </View>
      )}

      {refined && (
        <Pressable onPress={sendToLLM} style={s.cta}>
          <Text style={s.ctaText}>Send to {settings.llm.provider}</Text>
        </Pressable>
      )}

      {answer && (
        <View style={s.answerBox}>
          <Text style={s.answerHeader}>Response</Text>
          <Text style={s.answerText}>{answer}</Text>
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { padding: 20, paddingTop: 60, gap: 16 },
  title: { fontSize: 28, fontWeight: '700', color: '#f4f4f5' },
  sub: { fontSize: 13, color: '#a1a1aa' },
  mic: { alignItems: 'center', marginVertical: 24 },
  micOn: { transform: [{ scale: 1.05 }] },
  micBtn: {
    width: 96, height: 96, borderRadius: 48, backgroundColor: '#a78bfa',
    alignItems: 'center', justifyContent: 'center',
  },
  micIcon: { fontSize: 40 },
  micLabel: { color: '#a1a1aa', marginTop: 12, fontSize: 13 },
  label: { color: '#a1a1aa', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.05 },
  box: {
    backgroundColor: '#14161c', color: '#f4f4f5',
    borderRadius: 12, padding: 12, minHeight: 80,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  refinedBox: { backgroundColor: '#0f1116', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: 'rgba(167,139,250,0.3)' },
  refinedHeader: { color: '#a78bfa', fontSize: 12, textTransform: 'uppercase', marginBottom: 6 },
  refinedText: { color: '#f4f4f5', fontSize: 14, lineHeight: 20 },
  cta: { backgroundColor: '#a78bfa', padding: 14, borderRadius: 12, alignItems: 'center' },
  ctaText: { color: '#0b0c10', fontWeight: '700', fontSize: 15 },
  answerBox: { backgroundColor: '#14161c', borderRadius: 12, padding: 12 },
  answerHeader: { color: '#34d399', fontSize: 12, textTransform: 'uppercase', marginBottom: 6 },
  answerText: { color: '#f4f4f5', fontSize: 14, lineHeight: 20 },
});
