/**
 * Renderer — drives the floating pill.
 * Listens for `state` events from main, updates the UI.
 */

const pill = document.getElementById('pill')!;
const stateEl = document.getElementById('state')!;
const previewEl = document.getElementById('preview')!;
const cancel = document.getElementById('cancel')!;

const labels: Record<string, string> = {
  idle: 'Idle — press hotkey',
  listening: 'Listening…',
  transcribing: 'Transcribing…',
  refining: 'Refining prompt…',
  llm: 'Generating…',
  done: 'Done ✓',
  error: 'Error',
};

function setState(s: any) {
  pill.className = 'pill ' + s.kind;
  stateEl.textContent = labels[s.kind] ?? s.kind;
  if (s.kind === 'refining') previewEl.textContent = `${s.mode}: ${s.cleaned.slice(0, 120)}`;
  else if (s.kind === 'llm') previewEl.textContent = s.partial.slice(-200);
  else if (s.kind === 'done') previewEl.textContent = s.text.slice(-200);
  else if (s.kind === 'error') previewEl.textContent = s.message;
  else previewEl.textContent = '';
}

(window as any).wisper.onState(setState);

cancel.addEventListener('click', () => {
  window.close();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.close();
});
