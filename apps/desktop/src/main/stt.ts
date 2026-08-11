/**
 * STT (Speech-to-Text) module.
 *
 * Two providers:
 *   - transcribeLocal: shell out to whisper.cpp binary (must be on PATH)
 *   - transcribeOpenAI: call OpenAI's /v1/audio/transcriptions endpoint
 *
 * Both return plain text.
 */

import { execFile } from 'child_process';
import { writeFile, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import OpenAI from 'openai';

export async function transcribeLocal(pcm: Float32Array, model: string): Promise<string> {
  // 1. write a 16-bit PCM WAV
  const wav = pcmToWav(pcm, 16000);
  const dir = await mkdtemp(join(tmpdir(), 'wisper-'));
  const inPath = join(dir, 'in.wav');
  const outBase = join(dir, 'out');
  await writeFile(inPath, wav);

  // 2. shell out to whisper.cpp
  // user must `brew install whisper-cpp` or build from source
  const bin = process.env.WHISPER_CPP_BIN ?? 'whisper';
  await new Promise<void>((res, rej) => {
    execFile(bin, [
      '-m', `${model}.bin`,
      '-f', inPath,
      '-otxt',
      '-of', outBase,
      '--no-timestamps',
      '-l', 'auto',
    ], { timeout: 60_000 }, (err) => err ? rej(err) : res());
  });
  const txt = await (await import('fs/promises')).readFile(`${outBase}.txt`, 'utf-8');
  await rm(dir, { recursive: true, force: true });
  return txt.trim();
}

export async function transcribeOpenAI(pcm: Float32Array, model: string, apiKey: string): Promise<string> {
  const wav = pcmToWav(pcm, 16000);
  const dir = await mkdtemp(join(tmpdir(), 'wisper-'));
  const inPath = join(dir, 'in.wav');
  await writeFile(inPath, wav);
  const client = new OpenAI({ apiKey });
  const file = await import('fs').then((m) => m.createReadStream(inPath));
  // @ts-ignore — the SDK accepts a stream in Node
  const res = await client.audio.transcriptions.create({
    file: file as any,
    model: model || 'whisper-1',
    response_format: 'text',
  });
  await rm(dir, { recursive: true, force: true });
  return (res as any).text ?? String(res);
}

// ─── PCM → WAV (16-bit PCM, mono) ────────────────────────────────────────
function pcmToWav(pcm: Float32Array, sampleRate: number): Buffer {
  const numSamples = pcm.length;
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * bytesPerSample;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);          // fmt chunk size
  buf.writeUInt16LE(1, 20);           // PCM
  buf.writeUInt16LE(1, 22);           // channels
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(16, 34);          // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  let off = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    buf.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7fff, off);
    off += 2;
  }
  return buf;
}
