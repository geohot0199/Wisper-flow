/**
 * Local crypto for the BYOK API key.
 *
 * Algorithm: AES-256-GCM with a key derived from a per-install random
 * fingerprint (see getMachineFingerprint in main.ts). The fingerprint
 * is stored in the user-data dir with mode 0600.
 *
 * Even though this is not user-password-derived, it means:
 *   - Plaintext key only exists in memory after launch
 *   - On-disk dump is useless without the fingerprint
 *   - Fingerprint file is unreadable to other OS users
 */

import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from 'crypto';

const ALG = 'aes-256-gcm';
const SALT = Buffer.from('wisper-flow-v1');

function deriveKey(fp: string): Buffer {
  // PBKDF2 with 200k iterations — slow enough to deter brute force
  return pbkdf2Sync(fp, SALT, 200_000, 32, 'sha256');
}

export function encryptKey(plain: string, fingerprint: string): string {
  const key = deriveKey(fingerprint);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return 'enc:' + Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptKey(payload: string, fingerprint: string): string {
  if (!payload.startsWith('enc:')) return payload; // already plain
  const key = deriveKey(fingerprint);
  const buf = Buffer.from(payload.slice(4), 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const dec = createDecipheriv(ALG, key, iv);
  dec.setAuthTag(tag);
  return Buffer.concat([dec.update(data), dec.final()]).toString('utf-8');
}
