import { useState, useEffect } from 'react';
import { MMKV } from 'react-native-mmkv';

const storage = new MMKV({ id: 'wisper-flow' });

const DEFAULTS = {
  llm: { provider: 'openai' as const, model: 'gpt-4o-mini', apiKey: '' },
  mode: 'auto' as const,
  codingMode: false,
};

export function useSettings() {
  const [settings, setSettings] = useState(() => ({
    ...DEFAULTS,
    ...JSON.parse(storage.getString('settings') ?? '{}'),
  }));

  useEffect(() => {
    storage.set('settings', JSON.stringify(settings));
  }, [settings]);

  return {
    ...settings,
    setApiKey: (k: string) => setSettings((s: any) => ({ ...s, llm: { ...s.llm, apiKey: k } })),
    setProvider: (p: any) => setSettings((s: any) => ({ ...s, llm: { ...s.llm, provider: p } })),
    setModel: (m: string) => setSettings((s: any) => ({ ...s, llm: { ...s.llm, model: m } })),
    setMode: (m: any) => setSettings((s: any) => ({ ...s, mode: m })),
    setCodingMode: (b: boolean) => setSettings((s: any) => ({ ...s, codingMode: b })),
  };
}
