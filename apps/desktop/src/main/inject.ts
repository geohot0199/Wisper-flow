/**
 * Text injection module.
 *
 * The "type into any app" feature. Three backends:
 *   - Windows: SendInput via PowerShell (clipboard-paste atomically is
 *     most reliable)
 *   - macOS:   CGEventCreateKeyboardEvent (requires Accessibility permission)
 *   - Linux:   xdotool / ydotool
 *
 * Security notes:
 *   - We use `execFile` (NOT `exec`) so no shell is spawned and no string
 *     interpolation is possible.
 *   - All commands are hardcoded. No user input is ever passed to a shell.
 *   - The clipboard is briefly replaced with our text (~140 ms window).
 *     Other apps on the system can read it during that window. This is
 *     a known and accepted trade-off for cross-app text injection.
 *   - We restore the previous clipboard contents afterwards.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
// @ts-ignore — Electron types only present in the real build environment
import { clipboard } from 'electron';

const execFileP = promisify(execFile);

export interface ActiveWindow {
  id: string;
  title: string;
  app: string;
}

export async function getActiveWindow(): Promise<ActiveWindow | null> {
  try {
    if (process.platform === 'darwin') {
      const { stdout } = await execFileP('osascript', [
        '-e',
        'tell application "System Events" to get name of first application process whose frontmost is true',
      ]);
      const t = stdout.trim();
      return { id: 'mac', title: t, app: t };
    }
    if (process.platform === 'win32') {
      const { stdout } = await execFileP('powershell', [
        '-NoProfile',
        '-Command',
        '(Get-Process | Where-Object {$_.MainWindowTitle -ne "" -and $_.MainWindowHandle -eq (Get-Process -Id $PID).MainWindowHandle} | Select-Object -First 1).MainWindowTitle',
      ], { windowsHide: true });
      const t = stdout.trim();
      return { id: 'win', title: t, app: 'win' };
    }
    // Linux
    const { stdout } = await execFileP('xdotool', ['getactivewindow', 'getwindowname']);
    const t = stdout.trim();
    return { id: 'linux', title: t, app: 'linux' };
  } catch {
    return null;
  }
}

export async function injectText(text: string, opts?: { pasteOnly?: boolean }): Promise<void> {
  if (!text) return;
  const pasteOnly = opts?.pasteOnly ?? true;
  const prev = clipboard.readText();
  clipboard.writeText(text);

  // small delay to ensure the target app has focus
  await new Promise((r) => setTimeout(r, 60));

  try {
    if (process.platform === 'win32') {
      // Send Ctrl+V via PowerShell SendInput. Note: argument is a
      // *literal string* passed to PowerShell — no user data flows in.
      await execFileP('powershell', [
        '-NoProfile',
        '-Command',
        'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("^v")',
      ], { windowsHide: true });
    } else if (process.platform === 'darwin') {
      await execFileP('osascript', [
        '-e',
        'tell application "System Events" to keystroke "v" using command down',
      ]);
    } else {
      // Linux — try X11 first, then Wayland.
      try {
        await execFileP('xdotool', ['key', '--clearmodifiers', 'ctrl+v']);
      } catch {
        try {
          await execFileP('ydotool', ['key', '29:1', '47:1', '47:0', '29:0']);
        } catch { /* nothing */ }
      }
    }
  } catch (e) {
    // best-effort: clipboard still has the text, user can paste manually
    console.error('[inject] failed:', (e as Error).message);
  }

  // restore clipboard
  await new Promise((r) => setTimeout(r, 80));
  if (prev) clipboard.writeText(prev);
}
