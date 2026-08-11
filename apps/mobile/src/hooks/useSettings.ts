/**
 * Mobile settings hook.
 *
 * The LLM API key is stored in the OS-native secure store:
 *   - iOS:     Keychain (via react-native-keychain)
 *   - Android: Keystore-backed EncryptedSharedPreferences
 *              (via react-native-encrypted-storage)
 *
 * Non-secret settings (mode, model name, codingMode) live in AsyncStorage.
 * Never store the API key in AsyncStorage/MMKV — those are plaintext on disk.
 */
import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';

const STORAGE_KEY = 'wisper-flow-settings-v1';
const KEYCHAIN_SERVICE = 'com.wisperflow.llm';

const DEFAULTS = {
  provider: 'openai' as 'openai' | 'anthropic' | 'groq' | 'ollama',
  model: 'gpt-4o-mini',
  mode: 'auto' as 'auto' | 'general' | 'code' | 'email' | 'note' | 'shell',
  codingMode: false,
};

interface PersistedSettings {
  provider: typeof DEFAULTS.provider;
  model: string;
  mode: typeof DEFAULTS.mode;
  codingMode: boolean;
}

async function loadSettings(): Promise<PersistedSettings> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

async function saveSettings(s: PersistedSettings) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

async function loadApiKey(): Promise<string> {
  try {
    const creds = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });
    return creds ? creds.password : '';
  } catch {
    return '';
  }
}

async function saveApiKey(k: string) {
  if (!k) {
    await Keychain.resetGenericPassword({ service: KEYCHAIN_SERVICE });
    return;
  }
  await Keychain.setGenericPassword('llm', k, {
    service: KEYCHAIN_SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export function useSettings() {
  const [settings, setSettings] = useState<PersistedSettings>(DEFAULTS);
  const [apiKey, setApiKeyState] = useState<string>('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      setSettings(await loadSettings());
      setApiKeyState(await loadApiKey());
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (loaded) saveSettings(settings);
  }, [settings, loaded]);

  return {
    ...settings,
    apiKey,
    loaded,
    setApiKey: async (k: string) => {
      setApiKeyState(k);
      await saveApiKey(k);
    },
    setProvider: (p: typeof DEFAULTS.provider) =>
      setSettings((s) => ({ ...s, provider: p })),
    setModel: (m: string) => setSettings((s) => ({ ...s, model: m })),
    setMode: (m: typeof DEFAULTS.mode) => setSettings((s) => ({ ...s, mode: m })),
    setCodingMode: (b: boolean) => setSettings((s) => ({ ...s, codingMode: b })),
  };
}
