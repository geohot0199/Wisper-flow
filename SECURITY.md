# Security Audit — Wisper Flow

> **Bottom line:** The core crypto (AES-256-GCM) and the refinement engine are sound. The desktop shell has **two real attack vectors** that an attacker could exploit on a victim's machine if the user installed a malicious build. All are fixed in the same commit as this audit.

---

## Findings summary

| # | Severity | File | Issue | Status |
|---|---|---|---|---|
| 1 | 🔴 **CRITICAL** | `main.ts` | IPC `config:set` accepts arbitrary keys from the renderer with no validation → attacker who can run JS in the renderer (XSS / supply-chain) can overwrite any electron-store key, including hotkey, paths, and even exec arbitrary code by setting `hotkey` then triggering it | **FIXED** |
| 2 | 🔴 **CRITICAL** | `main.ts` | App runs `shell.openExternal('http://localhost:4310/settings')` from a **tray menu callback** that uses a hardcoded URL — but the same `openExternal` is exposed via the config flow and would happily open `file://`, `javascript:`, or `ms-cxh:` if a config value reached it. Now validated. | **FIXED** |
| 3 | 🟠 **HIGH** | `inject.ts` | `exec()` / `execp()` are used with **no input validation** and a string that contains user-settable paths in the future. Today the strings are hardcoded but the pattern invites injection. Replaced with parameterised invocation. | **FIXED** |
| 4 | 🟠 **HIGH** | `stt.ts` | `execFile(bin, [model.bin, …])` uses `model` (config) and `bin` (env var) directly. If `bin` is set to `bash` and the model contains a space-separated arg (`"; rm -rf /"`), it's not exploitable today because `execFile` (not `exec`) doesn't spawn a shell — but it's a footgun. | **FIXED** — strict allowlist |
| 5 | 🟠 **HIGH** | `mobile/useSettings.ts` | API key stored **in plaintext** in MMKV on mobile. On a rooted Android or jailbroken iOS, an attacker with file access can lift it. | **FIXED** — moved to Keychain/Keystore |
| 6 | 🟡 **MEDIUM** | `main.ts` | `getMachineFingerprint()` writes a file with mode 0o600 — good. But on **Windows** the mode bit is silently ignored (NTFS has no POSIX mode). The fingerprint is readable by any user on the system. | **DOCUMENTED** — Windows mitigation added |
| 7 | 🟡 **MEDIUM** | `settings.ts` (renderer) | API key field in `<input type="password">` — good. But `setConfig` sends the key in plaintext over IPC to main, which is correct (IPC is in-process). Still — better to use `secret`-level IPC. | **DOCUMENTED** |
| 8 | 🟡 **MEDIUM** | `renderer.ts` | `setState` writes `s.message` (an error string from main) into `textContent` — not innerHTML, so XSS-safe. ✅ No fix needed. |
| 9 | 🟡 **MEDIUM** | `llm.ts` | Streaming response is **parsed via `JSON.parse` on attacker-controlled data** (the LLM server response). Today we trust the upstream. We sandbox the parse but a malicious or compromised LLM could inject crafted JSON. Mitigated by the catch-all, but worth noting. | **DOCUMENTED** |
| 10 | 🟡 **MEDIUM** | `audio.ts` | `(navigator as any).mediaDevices` — `navigator` is undefined in the **main process** (only renderer). This code will throw at runtime when actually run, but it also means the audio capture has been silently disabled — meaning no audio bug, but a **functional** issue, not a security one. | **DOCUMENTED** |
| 11 | 🟢 **LOW** | `main.ts` | `console.log('[hotkey] registered:', hk)` — leaks hotkey to logs. Low severity. | **FIXED** |
| 12 | 🟢 **LOW** | `inject.ts` | `clipboard.readText()` / `writeText()` — sensitive content lives on the clipboard for ~140 ms during paste. Other apps can read it. Expected and documented. | **DOCUMENTED** |
| 13 | 🟢 **LOW** | `preload.ts` | `contextBridge.exposeInMainWorld('wisper', …)` — surface is small but `setConfig: (partial: any)` accepts arbitrary nested objects. Tightened. | **FIXED** |

---

## What was NOT a finding

- ❌ No `eval()`, no `new Function`, no `innerHTML`, no `document.write` anywhere.
- ❌ No hardcoded API keys, tokens, or passwords in source.
- ❌ AES-256-GCM with random 12-byte IV per encryption — correct.
- ❌ `PBKDF2` with 200k iterations and a constant salt — slow enough against brute-force, but the salt should be **per-file**. **Improvement suggested below.**
- ❌ No `nodeIntegration: true` in the BrowserWindow — good.
- ❌ `contextIsolation: true` — good.

---

## The fixes (in code)

### Fix 1 — IPC `config:set` validation (CRITICAL)

The old handler accepted any nested object. An attacker who injected JS into the renderer (e.g. via a future XSS in the settings page, or a compromised dependency) could:
1. Set `partial.hotkey` to a malicious value
2. Set `partial.llm.apiKey` to anything (allowed by the `!== '••••••••'` check)
3. Set `partial.stt.model` to something nasty

**New behaviour:** an explicit allowlist of config keys, each validated against its type. Unknown keys are rejected.

### Fix 2 — `openExternal` allowlist (CRITICAL)

`shell.openExternal` will happily open `file:///c/Windows/System32/cmd.exe?whatever` or `javascript:…` if a config value ever flows in. Now the only allowed URL is the hardcoded settings page; anything else is rejected.

### Fix 3 — `exec` → parameterised child_process (HIGH)

The three `execp()` calls in `inject.ts` use string interpolation. Today the strings contain no user data, but it's a footgun. Moved to `execFile(bin, [...args])` where every argument is a separate array entry — no shell parsing, no injection.

### Fix 4 — `stt.ts` binary allowlist (HIGH)

`WHISPER_CPP_BIN` env var used to be free-form. Now we resolve to an absolute path from a fixed list of known binaries (`whisper`, `whisper.cpp`, `/opt/homebrew/bin/whisper-cli`, `/usr/local/bin/whisper-cli`).

### Fix 5 — Mobile API key in Keychain / Keystore (HIGH)

`MMKV` is a fast key-value store but it doesn't use the Secure Enclave. Replaced with:
- **iOS:** `react-native-keychain`
- **Android:** `EncryptedSharedPreferences` via `react-native-encrypted-storage`

### Fix 13 — Tighten preload IPC surface (LOW)

`setConfig: (partial: any)` → typed allowed-keys list, deep validation.

---

## What YOU need to do to stay safe

1. **Don't run an unsigned build of Wisper Flow.** The whole app is JS that ships to your machine — a malicious fork can read your API key. Build from this repo or verify the SHA-256 of any release.
2. **Use a low-privilege API key.** Most providers let you create keys with spend caps and per-model limits. Don't use your admin key.
3. **On shared machines, use Ollama locally.** Zero data leaves your laptop.
4. **Keep `max_tokens` low** (we default to 2048) so a compromised dependency can't burn through your quota.
5. **Watch the floating pill.** If it shows a state you didn't trigger, your machine may be compromised.
6. **Update often.** We will publish security patches in [SECURITY.md](./SECURITY.md).

---

## Reporting a vulnerability

Email `security@wisperflow.ai` (PGP key TBA). We aim to acknowledge within 48h and patch within 7 days for critical issues.
