/**
 * Audio capture module.
 *
 * Strategy:
 *   - Mic capture: Web Audio API via an offscreen BrowserWindow
 *     (no native deps required — works on Win/Mac/Linux identically).
 *   - VAD: energy-based detector (RMS threshold) for now. In v2, swap to
 *     Silero VAD (ONNX) for better accuracy. The interface stays the same.
 *
 * The onVadEnd callback fires when the user has been silent for ~1.5s.
 */

export interface CaptureOptions {
  onVadEnd: (pcm: Float32Array) => void | Promise<void>;
  silenceMs?: number;
  rmsThreshold?: number;
}

let stream: MediaStream | null = null;
let audioCtx: AudioContext | null = null;
let stopped = false;

export async function captureAudio(opts: CaptureOptions) {
  stopped = false;
  // In a packaged Electron app, BrowserWindow doesn't have DOM MediaStream
  // unless you use a renderer; in dev we use the renderer's getUserMedia
  // forwarded via IPC. Here we expose a clean async interface.
  const audio = await (navigator as any).mediaDevices.getUserMedia({
    audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true },
  });
  stream = audio;
  audioCtx = new AudioContext({ sampleRate: 16000 });
  const src = audioCtx.createMediaStreamSource(audio);
  const proc = audioCtx.createScriptProcessor(4096, 1, 1);

  const buffer: Float32Array[] = [];
  let lastSound = Date.now();
  const silenceMs = opts.silenceMs ?? 1500;
  const threshold = opts.rmsThreshold ?? 0.01;

  proc.onaudioprocess = (e: AudioProcessingEvent) => {
    if (stopped) return;
    const ch = e.inputBuffer.getChannelData(0);
    // copy because the channel buffer is reused
    const copy = new Float32Array(ch.length);
    copy.set(ch);
    buffer.push(copy);
    let sum = 0;
    for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
    const rms = Math.sqrt(sum / ch.length);
    if (rms > threshold) lastSound = Date.now();
    else if (Date.now() - lastSound > silenceMs && buffer.length > 3) {
      stopped = true;
      // concatenate
      const total = buffer.reduce((n, b) => n + b.length, 0);
      const out = new Float32Array(total);
      let off = 0;
      for (const b of buffer) { out.set(b, off); off += b.length; }
      proc.disconnect();
      src.disconnect();
      audio.getTracks().forEach((t: MediaStreamTrack) => t.stop());
      audioCtx?.close();
      Promise.resolve(opts.onVadEnd(out)).catch((e) => console.error(e));
    }
  };

  src.connect(proc);
  proc.connect(audioCtx.destination);
}

export async function stopCapture() {
  stopped = true;
  stream?.getTracks().forEach((t) => t.stop());
  await audioCtx?.close();
  stream = null;
  audioCtx = null;
}
