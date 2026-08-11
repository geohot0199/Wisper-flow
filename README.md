# Wisper Flow

> **Speak naturally. Wisper Flow listens, refines into an LLM-ready prompt, and types the answer into whatever app is in focus.**

Like Siri/Gemini, but for **everything you write** — VS Code, WhatsApp, Gmail, terminals, Notion — and it comes with a **Coding Mode** that re-frames your voice into a software-engineering spec so the AI returns production-quality code.

> [!NOTE]
> **Project status:** Wisper Flow is an early `v0.1` source release. The shared refinement engine, desktop pipeline, security boundaries, and headless smoke path are automated and tested. Desktop installers, native audio capture, and mobile release builds still require platform-specific validation before production use.

---

## What it does

| Feature | Description |
|---|---|
| 🎙 **Voice capture** | Hold a global hotkey, talk, release. Like Siri/Google Assistant. |
| 🧹 **Filler strip** | "um so like I want to um build a thing" → "I want to build a thing" |
| 🎯 **Intent classifier** | Auto-detects code, email, note, shell, or general |
| 👨‍💻 **Coding mode** | Injects software-engineering requirements (edge cases, docstrings, tests, trade-offs) |
| 🤖 **BYOK LLM** | Bring your own OpenAI / Anthropic / Groq / Ollama key |
| ⌨️ **Types into any app** | VS Code, WhatsApp, Gmail, Slack, terminals — the focused window |
| 🔒 **Encrypted at rest** | API key AES-256-GCM encrypted with a per-install fingerprint |
| 🪟 **Cross-platform** | Windows, macOS, Linux, iOS, Android |

---

## How a session flows

```
[press Ctrl+Shift+Space]
       ↓
[listening…]
       ↓
[silence detected after 1.5s]
       ↓
[Whisper STT]   ──→  raw transcript
       ↓
[@wisper-flow/refinement]
  • stripFiller
  • classifyIntent
  • buildCodingPrompt (if mode = code)
  • enforceBudget
       ↓
[refined, LLM-ready prompt]
       ↓
[stream LLM response]
       ↓
[Ctrl+V paste into previously focused window]
       ↓
[done ✓]
```

---

## Quick start

### Prerequisites
- **Node.js 20+** (download from [nodejs.org](https://nodejs.org))
- **npm 10+** (comes with Node)
- **macOS:** Accessibility permission (one-time grant in System Settings → Privacy & Security)
- **Windows:** No extra permission needed
- **Linux:** `sudo apt install xdotool` (or `ydotool` for Wayland)
- **For local Whisper STT:** install `whisper-cpp` ([instructions](https://github.com/ggerganov/whisper.cpp))

### Install, build, and verify

```bash
git clone https://github.com/geohot0199/Wisper-flow.git
cd Wisper-flow

# Build and test the shared refinement engine.
cd packages/refinement
npm ci
npm run build
npm test
cd ../..

# Install desktop dependencies and run its pipeline/security tests.
cd apps/desktop
npm ci
node --test --import tsx test/*.test.mts
cd ../..

# Exercise refinement and encryption without launching a GUI.
npx --yes tsx scripts/smoke.ts
```

A successful smoke run ends with:

```text
10 passed, 0 failed
```

### Run the desktop app

Electron is not needed by the headless test suite, so install it only when you want to run the GUI:

```bash
cd apps/desktop
npm install --no-save --package-lock=false electron
npm start
```

The app starts in your tray. Press the global hotkey (**Ctrl+Shift+Space** on Windows/Linux, **Option+Space** on Mac), speak, release. The pill at the top shows the current state.

### First-time setup
1. **Right-click the tray icon → Settings** opens a window.
2. Enter your LLM API key (OpenAI, Anthropic, Groq, or leave blank for Ollama).
3. Pick a STT provider:
   - **Local whisper-cpp** (free, offline, needs install)
   - **OpenAI Whisper** (~$0.006/min, very accurate)
4. Click **Save Settings**.

### Try the refinement engine
In Settings, paste this into the test box:
```
um so like I want to write a python function that takes a list and returns the max value
```
Click **Refine**. You'll see the cleaned transcript, the detected mode (`code`), the detected language (`python`), and the final LLM-ready prompt.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                Native Tray App (Electron)                    │
│                                                              │
│  Global Hotkey ─→ Audio Capture (Web Audio API)              │
│         │              │                                    │
│         │              ▼                                    │
│         │        Silero VAD (energy, v2: ONNX)              │
│         │              │                                    │
│         │              ▼                                    │
│         │        STT Engine (whisper.cpp | OpenAI)           │
│         │              │                                    │
│         │              ▼ raw transcript                     │
│         │     @wisper-flow/refinement                       │
│         │       • stripFiller                               │
│         │       • classifyIntent                            │
│         │       • buildCodingPrompt                         │
│         │       • enforceBudget                             │
│         │              │                                    │
│         │              ▼ refined prompt                     │
│         ▼              ▼                                    │
│      remember       LLM (BYOK)                              │
│      focused        openai | anthropic | groq | ollama      │
│      window                │                                │
│                            ▼ streamed response              │
│       injectText (Ctrl+V into remembered window)            │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

See [`STRATEGY.md`](./STRATEGY.md) for the full architecture document, data flow, SDLC phases, monetization plan, and competitive analysis.

---

## Activation: Siri/Gemini-style

| Where you are | What you do | What happens |
|---|---|---|
| **Windows desktop** | Press `Ctrl+Shift+Space` anywhere | Floating pill appears at top, listening starts |
| **macOS desktop** | Press `Option+Space` anywhere | Same (after one-time Accessibility grant) |
| **Linux desktop** | Press `Ctrl+Shift+Space` (X11) or `Super+Space` (Wayland) | Same |
| **Android** | Swipe down from top of screen, tap the **Wisper Flow** tile | App opens directly into dictation |
| **iOS** | Long-press Lock Screen / Home Screen, pick **Wisper Flow** widget, or set as iPhone 15 Pro Action Button | App opens directly into dictation |
| **Any** | Say "Hey Wispr" (optional, opt-in) | Same (uses on-device Porcupine wake-word) |

---

## Repo layout

```
Wisper-flow/
├── apps/
│   ├── desktop/             # Electron app (Win/Mac/Linux)
│   │   ├── src/main/        # capture, STT, LLM, inject, crypto
│   │   ├── src/renderer/    # floating pill UI + settings page
│   │   └── test/            # integration tests
│   └── mobile/              # React Native (iOS/Android)
│       ├── ios/AppIntents/  # Action Button / widget integration
│       └── android/...      # Quick Settings Tile
├── packages/
│   └── refinement/          # Pure-TS prompt engine (shared)
├── scripts/
│   └── smoke.ts             # No-GUI end-to-end test
├── SECURITY.md              # Security audit and reporting guidance
├── STRATEGY.md              # Full architecture + SDLC + monetization
└── README.md                # You are here
```

---

## Testing

The repository currently has **56 automated checks** across the shared engine and desktop boundary:

| Layer | Coverage | Where |
|---|---|---|
| **Refinement engine** | 31 unit tests for filler removal, intent/language detection, prompt construction, input limits, and token budgets | `packages/refinement/test/refine.test.ts` |
| **Desktop pipeline** | 4 integration tests for refinement → template → final message | `apps/desktop/test/pipeline.test.mts` |
| **Desktop security** | 11 tests for config validation, provider allowlists, range checks, and prototype-pollution attempts | `apps/desktop/test/security.test.mts` |
| **Headless smoke path** | 10 checks, including AES-GCM round-trip verification | `scripts/smoke.ts` |

Run the complete suite from the repository root:

```bash
(cd packages/refinement && npm ci && npm test)
(cd apps/desktop && npm ci && node --test --import tsx test/*.test.mts)
npx --yes tsx scripts/smoke.ts
```

---

## Configuration

All settings are stored encrypted in your OS user-data dir:
- **Windows:** `%APPDATA%\wisper-flow\wisper-flow-config.json`
- **macOS:** `~/Library/Application Support/wisper-flow/wisper-flow-config.json`
- **Linux:** `~/.config/wisper-flow/wisper-flow-config.json`

---

## Security

- Desktop API keys use versioned **AES-256-GCM** encryption with a random salt and IV for every encrypted blob. Keys are derived from a per-install fingerprint with PBKDF2-HMAC-SHA256 (200,000 iterations).
- The fingerprint is restricted to the current user with `0600` permissions on macOS/Linux and a best-effort user-only ACL on Windows.
- Mobile credentials use iOS Keychain and Android Keystore-backed encrypted storage rather than plaintext application preferences.
- Renderer configuration crosses a typed, allowlisted IPC boundary; unknown keys, invalid providers, unsafe values, and prototype-pollution keys are rejected.
- Child processes use parameterized `execFile` calls, and external URLs are restricted to HTTP(S) loopback addresses.
- Plaintext credentials exist only in process memory while needed. Cross-app injection briefly uses the system clipboard and then restores its previous text.
- There is no telemetry or analytics. Network requests go only to the STT/LLM provider selected by the user; Ollama remains on `localhost`.

Read [`SECURITY.md`](./SECURITY.md) for the audit findings, mitigations, operational guidance, and vulnerability-reporting process.

---

## Roadmap

- [x] Refinement engine (v0.1)
- [x] Electron shell with global hotkey + overlay
- [x] BYOK LLM (OpenAI, Anthropic, Groq, Ollama)
- [x] Cross-OS text injection (clipboard-paste)
- [x] Mobile shell (React Native)
- [x] Android Quick Settings Tile
- [x] iOS App Intent (Action Button / widget)
- [ ] **Silero VAD** for accurate silence detection (v0.2)
- [ ] **whisper.cpp** bundled binary (no install) (v0.2)
- [ ] **Wake word** ("Hey Wispr") with on-device Porcupine (v0.3)
- [ ] **Voice macros** — "Hey Wispr, new commit message" → generates commit msg + types (v0.4)
- [ ] **Prompt template library** — share custom coding profiles (Pro) (v0.5)

See [`STRATEGY.md`](./STRATEGY.md) § 6 for the full SDLC and § 8 for the activation design.

---

## License

MIT — see [LICENSE](./LICENSE).

---

## Credits

Built by [geohot0199](https://github.com/geohot0199) and contributors. Uses:
- [`whisper.cpp`](https://github.com/ggerganov/whisper.cpp) — MIT
- [Electron](https://www.electronjs.org/) — MIT
- [OpenAI Node SDK](https://github.com/openai/openai-node) — MIT
