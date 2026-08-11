# Wisper Flow — Full Strategy, Architecture & SDLC

> **One-line vision:** Speak naturally. Wisper Flow listens, cleans, refines into an LLM-ready prompt (with a **coding mode** that injects software-engineering framing), and **types the answer back into whatever app is in focus** — VS Code, WhatsApp, Gmail, terminals, anything.

---

## 1. Product Strategy

### 1.1 Why it wins
- **Token economics:** A 30-second "umm so like I want to build a thingy that uh logs in" gets compressed into a 60-token crisp spec. Less $ spent, better answers.
- **App-agnostic injection:** Unlike Wispr (which types into one focused field), we **type into the focused window** of any app — VS Code, WhatsApp, Gmail, Slack, terminals.
- **Coding mode:** Spoken words are normalized into a software-engineering brief (constraints, I/O contracts, edge cases, test expectations) so the downstream LLM returns production-shaped code.
- **Bring-your-own key (BYOK):** User supplies their OpenAI / Anthropic / Groq / local-ollama key. No vendor lock-in, no monthly fee eating margin.

### 1.2 Personas
| Persona | Job-to-be-done |
|---|---|
| Developer | Dictate code, todos, refactor instructions into VS Code / terminal |
| PM / Writer | Hands-free, polished prose into Gmail, Notion, Slack |
| Student | Lecture-to-structured-notes |
| Accessibility user | Full voice control of any text field |

### 1.3 Competitive moat
1. **Prompt refinement layer** (most dictation apps just transcribe — they don't engineer the prompt).
2. **Coding mode** (no competitor combines dictation + prompt engineering + IDE injection).
3. **Local-first + BYOK** (privacy, zero recurring cost, works offline with Whisper local).

### 1.4 Monetization (later, not now)
- Free: BYOK, unlimited local Whisper
- Pro ($8/mo): hosted Whisper large-v3, prompt templates library, voice macros
- Team ($20/seat): shared prompt library, custom coding-mode profiles (React, Python, Rust…)

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    OS-Level Capture Layer                    │
│  (Win: WASAPI loopback   |  Mac: BlackHole/AVAudioEngine    │
│   Linux: PulseAudio monitor)                                │
└──────────────┬──────────────────────────────────────────────┘
               │ raw PCM @ 16 kHz mono
               ▼
┌──────────────────────────────────────────────────────────────┐
│                Native Tray App (single binary)               │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐  │
│  │ Hotkey Mgr  │  │ VAD (silence │  │ Active-Window       │  │
│  │ (global key │  │  detector,   │  │ Detector            │  │
│  │  combo)     │  │  silero VAD) │  │ (Win32 EnumWindows  │  │
│  └──────┬──────┘  └──────┬───────┘  │  macOS Accessibility │  │
│         │                │          │  X11 _NET_ACTIVE_WINDOW)│
│         ▼                ▼          └──────────┬────────────┘  │
│  ┌────────────────────────────────┐            │              │
│  │   Audio Buffer + Ring Buffer   │            │              │
│  └──────────────┬─────────────────┘            │              │
│                 ▼                               ▼              │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │              STT Engine (pluggable)                      │  │
│  │   whisper.cpp (local)  |  OpenAI Whisper  |  Groq        │  │
│  └──────────────┬──────────────────────────────────────────┘  │
│                 ▼ raw transcript                              │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │              Prompt Refinement Engine                    │  │
│  │  ┌──────────┐  ┌──────────┐  ┌───────────────────────┐  │  │
│  │  │ Filler   │─▶│ Intent   │─▶│ Coding-Mode           │  │  │
│  │  │ Strip    │  │ Classifier│  │  Re-framer            │  │  │
│  │  └──────────┘  └──────────┘  │  (SE-aware templates) │  │  │
│  │                              └───────────────────────┘  │  │
│  │                              │                          │  │
│  │                              ▼                          │  │
│  │              Token-Budget Optimizer (tiktoken)            │  │
│  └──────────────┬──────────────────────────────────────────┘  │
│                 ▼ refined prompt                             │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │              LLM Engine (pluggable)                     │  │
│  │  OpenAI  |  Anthropic  |  Groq  |  Ollama (local)       │  │
│  └──────────────┬──────────────────────────────────────────┘  │
│                 ▼ response                                   │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │              Text Injector                               │  │
│  │  Win: SendInput / clipboard paste-atomically              │  │
│  │  Mac: CGEventCreateKeyboardEvent / Accessibility API      │  │
│  │  Linux: xdotool / ydotool                                 │  │
│  └──────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### 2.1 Mobile (iOS / Android) companion
- Same refinement engine in React Native
- Push-to-talk from keyboard extension
- Shares user config + API key via encrypted iCloud Drive / Drive
- Types into the focused mobile field via AccessibilityService (Android) / UITextInput (iOS 17+)

---

## 3. Data Flow (single dictation session)

```
[Hotkey Press] → [VAD listens] → [silence detected] → [STT (Whisper)]
   → [Raw Transcript]
   → [Filler Strip] → [Intent Classify] → [Mode-Apply]
   → [Refined Prompt]
   → [Token Budget Check]
        ├─ under budget ──▶ [LLM Call] ──▶ [Stream response]
        └─ over budget  ──▶ [Compress / summarize] ──▶ [LLM Call]
   → [Type into focused window char-by-char (or paste-atomically)]
   → [Log session to local encrypted SQLite]
```

---

## 4. Tech Stack (concrete picks)

| Layer | Choice | Why |
|---|---|---|
| Tray app shell | **Tauri 2** (Rust + webview) | Single binary, 10× smaller than Electron, native hotkeys & tray, cross-platform Win/Mac/Linux |
| STT local | **whisper.cpp** (whisper-rs crate) | MIT, runs offline, Metal/CUDA/Vulkan, tiny.cpp for ARM |
| STT cloud fallback | OpenAI `gpt-4o-transcribe`, Groq `whisper-large-v3` | Speed + accuracy |
| VAD | **Silero VAD** (ONNX, 2 MB) | Best accuracy / size trade-off |
| LLM | OpenAI / Anthropic / Groq / Ollama | BYOK |
| Tokenizer | **tiktoken-rs** | Same tokenizer as OpenAI for accurate counts |
| Window detection | `active-win-pos-rs` (Win/Mac/Linux) | Maintained, no deps |
| Text injection (Win) | `enigo` crate + `SendInput` fallback | Works in elevated + non-elevated |
| Text injection (Mac) | `enigo` + Accessibility API permission | Requires user one-time grant |
| Text injection (Linux) | `xdotool` or `ydotool` (Wayland) | Wayland-compatible fallback |
| Local storage | `rusqlite` with SQLCipher | Encrypted at rest |
| Crypto | `aes-gcm` for key vault, key derived from OS keychain | Zero plaintext on disk |
| Mobile | React Native + native modules | Share TS core for refinement engine |
| CI / Release | GitHub Actions → Tauri bundler → .msi / .dmg / .AppImage / .deb | One pipeline, all OS |

---

## 5. Software Development Lifecycle

### Phase 0 — Discovery (done in this doc)
Strategy, persona, moat, monetization.

### Phase 1 — MVP (4 weeks)
- [x] Repo scaffold (Tauri 2)
- [x] Global hotkey (Ctrl+Shift+Space)
- [x] Local Whisper via whisper-rs (base.en)
- [x] Raw text injection into focused window
- [x] BYOK settings UI (OpenAI)
- [x] One-shot prompt refinement (filler strip + intent + reframe)

### Phase 2 — Coding Mode + LLM (2 weeks)
- [x] Coding-mode prompt template library (Python, JS/TS, Rust, SQL, shell, generic)
- [x] LLM streaming + token-budget guard
- [x] Mode switcher: `general` / `code` / `email` / `note`

### Phase 3 — Cross-platform polish (2 weeks)
- [x] macOS accessibility-permission flow
- [x] Windows installer (MSIX) + auto-update
- [x] Linux .AppImage + .deb

### Phase 4 — Mobile (3 weeks)
- [x] React Native app, push-to-talk keyboard
- [x] Share refinement engine as TS lib
- [x] iOS TestFlight, Android internal track

### Phase 5 — QA & Hardening (1 week)
- E2E: dictation → injection in 5 real apps per OS
- Perf: <400 ms p50 from hotkey-release to first typed char
- Security: API key never leaves device, all comms TLS, prompt-injection guard in refinement

---

## 6. Testing Strategy (top-to-bottom-to-core)

| Layer | Test | Tool |
|---|---|---|
| UI | Vitest + Playwright (webview) | component + flow |
| Engine | Rust unit tests for filler strip, intent classifier, re-framer, token counter | `cargo test` |
| Integration | Dictation fixtures → expected refined prompt (golden file) | `insta` snapshot |
| E2E OS | Win/Mac/Linux VMs: record audio, inject into VS Code, WhatsApp Web, Gmail | custom harness in `tests/e2e` |
| Security | Pen-test: prompt-injection, key extraction from disk, network sniff | manual + `cargo audit` |
| Perf | Latency from hotkey-release → first keystroke | `criterion` + manual |

**Definition of Done for every PR:**
- All unit + integration tests green
- No `unwrap()` on user-input paths
- Public functions have docstring + at least one test
- Bundle size delta documented in PR body

---

## 7. What you need to provide to make it work
1. **An LLM API key** (OpenAI / Anthropic / Groq / Ollama local) — entered in Settings
2. **Microphone permission** — granted once on first run
3. **(macOS only) Accessibility permission** — granted in System Settings
4. **(Windows only) No extra permission** — works out of the box
5. **(Linux) `xdotool` or `ydotool` installed** — for text injection

Everything else is bundled.

---

## 8. Global Activation (Siri / Gemini-style)

> **The "press one button" requirement.** No app-switching, no menu digging. One gesture from anywhere.

### 8.1 Desktop — always-on listening for a hotkey (or wake word)

| OS | Primary trigger | Secondary trigger | Notes |
|---|---|---|---|
| Windows | `Ctrl + Shift + Space` (global) | Optional wake word "Hey Wispr" | Registered via `RegisterHotKey` Win32 / `node-global-shortcut` |
| macOS | `⌥ (Option) + Space` (global) | `fn` x2 or wake word | Needs Accessibility permission for the hotkey to work globally |
| Linux (X11) | `Ctrl + Shift + Space` | Wake word | `xdotool key` or D-Bus `GlobalShortcuts` |
| Linux (Wayland) | `Super + Space` via GNOME extension | Wake word | `ydotool` for injection |

**Wake-word mode** (optional, off by default for privacy):
- Uses **Porcupine** (picovoice, ~2 MB, on-device) or **openWakeWord** (open source, ONNX)
- Runs in a separate low-priority thread, draws <1% CPU when silent
- Disabled if microphone is already in use (Zoom, Discord, etc.)

**Overlay UX** (like Gemini's floating bar):
- On hotkey press, show a **floating pill at the top-center of the screen** (transparent, always-on-top)
- Pill has a **pulsing waveform** while listening
- Press hotkey again, or stay silent for 1.5s → pill flips to "refining…" → "typing…"
- Press `Esc` to cancel mid-sentence

### 8.2 Mobile — system-level entry points

| OS | Entry point | Implementation |
|---|---|---|
| Android | Quick Settings tile + Home screen widget + Lock screen shortcut | `TileService` (one-tap from notification shade), App Widget, `ShortcutManager` |
| Android | Optional: long-press home (Gesture nav) | Accessibility service for "Assistant gesture" |
| iOS | Lock-screen widget + Home screen widget + Action Button (iPhone 15 Pro) | `WidgetKit`, `App Intents` framework (iOS 16+) |
| iOS | Back-tap (double/triple tap on back) | Accessibility shortcut → App Intent |

**No "Home button launches app"** — modern iOS/Android don't expose a "home button = your app" hook. Instead we:
1. Add a **Quick Settings tile** (Android) — single swipe from top, one tap → overlay opens → dictation starts
2. Add a **Home Screen widget** (both) — single tap → app opens directly to dictation
3. Register as a **keyboard input method** on Android → invoke Wisper from any text field, anywhere

**Result:** From any screen, two taps max (swipe + tap on tile, or tap widget) and you're dictating.

### 8.3 Why this beats Wispr / competitors
- Wispr = single key, types into one field
- Wisper Flow = **Siri-like overlay + multi-app injection + coding mode + prompt refinement**
- Once you feel the "speak → refined prompt → typed into VS Code" loop, you never go back to typing

---

## 9. Repo layout
```
Wisper-flow/
├── apps/
│   ├── desktop/         # Tauri 2 app (Rust + webview)
│   │   ├── src-tauri/   # Rust: capture, STT, injection, refinement
│   │   ├── src/         # TS: settings UI, tray menu
│   │   └── tests/       # e2e
│   └── mobile/          # React Native
├── crates/
│   ├── wisper-core/     # Prompt refinement engine (no_std-friendly)
│   ├── wisper-stt/      # whisper-rs wrapper + cloud STT clients
│   ├── wisper-llm/      # LLM clients + token budget
│   └── wisper-inject/   # Cross-OS text injection
├── packages/
│   └── refinement/      # TS port of the refinement engine (shared with mobile)
├── docs/                # Architecture diagrams, ADRs
├── .github/workflows/   # CI
├── STRATEGY.md          # ← you are here
└── README.md
```
