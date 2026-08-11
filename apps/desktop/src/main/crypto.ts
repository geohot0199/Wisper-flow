/**
 * Local crypto for the BYOK API key.
 *
 * Algorithm: AES-256-GCM with a key derived from a per-install random
 * fingerprint (see getMachineFingerprint in main.ts). The fingerprint
 * is stored in the user-data dir with mode 0600 (POSIX) or restricted
 * ACL (Windows). A per-blob random salt is mixed into PBKDF2.
 *
 * Properties:
 *   - Plaintext key only exists in memory after launch
 *   - On-disk dump of the encrypted blob is useless without the fingerprint
 *   - Fingerprint file is unreadable to other OS users (best effort)
 *   - Even if the fingerprint is leaked, the per-blob salt + 200k PBKDF2
 *     rounds make brute force slow
 */

import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from 'crypto';

const ALG = 'aes-256-gcm';
const KDF_ITER = 200_000;
const SALT_LEN = 16;

function deriveKey(fp: string, salt: Buffer): Buffer {
  return pbkdf2Sync(fp, salt, KDF_ITER, 32, 'sha256');
}

/**
 * Format: enc:v1:<salt-b64>:<iv-b64>:<tag-b64>:<ct-b64>
 * The v1 tag lets us upgrade the format later without breaking old blobs.
 */
export function encryptKey(plain: string, fingerprint: string): string {
  const salt = randomBytes(SALT_LEN);
  const key = deriveKey(fingerprint, salt);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    'enc', 'v1',
    salt.toString('base64'),
    iv.toString('base64'),
    tag.toString('base64'),
    enc.toString('base64'),
  ].join(':');
}

export function decryptKey(payload: string, fingerprint: string): string {
  if (!payload.startsWith('enc:')) return payload; // already plain
  const parts = payload.split(':');
  if (parts.length !== 6 || parts[0] !== 'enc' || parts[1] !== 'v1') {
    // legacy blob (v0) — try to decode with the old format
    return decryptKeyLegacy(payload, fingerprint);
  }
  const saltB64 = parts[2];
  const ivB64 = parts[3];
  const tagB64 = parts[4];
  const ctB64 = parts[5];
  const salt = Buffer.from(saltB64, 'base64');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  if (salt.length !== SALT_LEN || iv.length !== 12 || tag.length !== 16) {
    throw new Error('Encrypted key: malformed');
  }
  const key = deriveKey(fingerprint, salt);
  const dec = createDecipheriv(ALG, key, iv);
  dec.setAuthTag(tag);
  return Buffer.concat([dec.update(ct), dec.final()]).toString('utf-8');
}

// Legacy v0 decoder (constant salt) for backward compat on first launch.
function decryptKeyLegacy(payload: string, fingerprint: string): string {
  try {
    const buf = Buffer.from(payload.slice(4), 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const key = pbkdf2Sync(fingerprint, Buffer.from('wisper-flow-v1'), KDF_ITER, 32, 'sha256');
    const dec = createDecipheriv(ALG, key, iv);
    dec.setAuthTag(tag);
    return Buffer.concat([dec.update(data), dec.final()]).toString('utf-8');
  } catch {
    return ''; // corrupted — user will re-enter key
  }
}
