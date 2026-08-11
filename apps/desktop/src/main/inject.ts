/**
 * Text injection module.
 *
 * The "type into any app" feature. Three backends:
 *   - Windows: SendInput (clipboard-paste atomically is most reliable)
 *   - macOS:   CGEventCreateKeyboardEvent (requires Accessibility permission)
 *   - Linux:   xdotool / ydotool
 *
 * We use the **clipboard-paste** approach on every OS because it is:
 *   1. Works inside VS Code, terminals, WhatsApp Web, Gmail, etc.
 *   2. Preserves Unicode, emojis, newlines.
 *   3. Bypasses apps that block synthetic key events.
 *
 * For the truly paranoid there's a `pasteOnly` flag (default true) that
 * preserves the user's existing clipboard and restores it after paste.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
// @ts-ignore — Electron types only present in the real build environment
import { clipboard } from 'electron';

const execp = promisify(exec);

export interface ActiveWindow {
  id: string;
  title: string;
  app: string;
}

export async function getActiveWindow(): Promise<ActiveWindow | null> {
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execp(
        `osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`,
      );
      return { id: 'mac', title: stdout.trim(), app: stdout.trim() };
    } catch { return null; }
  }
  if (process.platform === 'win32') {
    // PowerShell one-liner to get the foreground window title
    try {
      const { stdout } = await execp(
        `powershell -NoProfile -Command "(Get-Process | Where-Object {$_.MainWindowTitle -ne '' -and $_.MainWindowHandle -eq (Get-Process -Id $PID).MainWindowHandle} | Select-Object -First 1).MainWindowTitle"`,
        { windowsHide: true },
      );
      return { id: 'win', title: stdout.trim(), app: 'win' };
    } catch { return null; }
  }
  // Linux
  try {
    const { stdout } = await execp(
      `xdotool getactivewindow getwindowname 2>/dev/null || echo ""`,
    );
    return { id: 'linux', title: stdout.trim(), app: 'linux' };
  } catch { return null; }
}

export async function injectText(text: string, opts?: { pasteOnly?: boolean }): Promise<void> {
  if (!text) return;
  const pasteOnly = opts?.pasteOnly ?? true;
  const prev = clipboard.readText();
  clipboard.writeText(text);

  // small delay to ensure the target app has focus
  await new Promise((r) => setTimeout(r, 60));

  if (process.platform === 'win32') {
    // Send Ctrl+V via PowerShell SendInput
    await execp(
      `powershell -NoProfile -Command "
        Add-Type -AssemblyName System.Windows.Forms;
        [System.Windows.Forms.SendKeys]::SendWait('^v');
      "`,
      { windowsHide: true },
    );
  } else if (process.platform === 'darwin') {
    await execp(`osascript -e 'tell application "System Events" to keystroke "v" using command down'`);
  } else {
    // Linux
    try {
      await execp(`xdotool key --clearmodifiers ctrl+v`);
    } catch {
      // Wayland fallback
      try { await execp(`ydotool key 29:1 47:1 47:0 29:0`); } catch { /* nothing */ }
    }
  }

  // restore clipboard
  await new Promise((r) => setTimeout(r, 80));
  if (prev) clipboard.writeText(prev);
}
