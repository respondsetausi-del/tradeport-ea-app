import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

/**
 * Encryption for broker credentials at rest.
 *
 * A strategy run stores the MT5 login and password so it can revive its own
 * session while every device is asleep. That is unavoidable for unattended
 * trading, but it means a database dump would otherwise hand over live trading
 * accounts in plaintext.
 *
 * AES-256-GCM: authenticated, so a tampered row fails to decrypt rather than
 * silently yielding garbage that gets sent to the broker.
 *
 * The key comes from CREDS_KEY (any string; hashed to 32 bytes). With no key
 * set, encrypt() returns null and the caller MUST refuse to store credentials
 * rather than fall back to plaintext.
 */
const ALGO = 'aes-256-gcm';
const PREFIX = 'v1';

function key(): Buffer | null {
  const raw = process.env.CREDS_KEY;
  if (!raw || raw.length < 16) return null;
  // Hash rather than requiring an exact 32-byte value, so any sufficiently
  // long secret works — and a short one is rejected above rather than padded.
  return createHash('sha256').update(raw).digest();
}

export function encryptionAvailable(): boolean {
  return key() !== null;
}

/** Returns `v1:<iv>:<tag>:<ciphertext>` (base64 parts), or null with no key. */
export function encrypt(plaintext: string): string | null {
  const k = key();
  if (!k) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, k, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

/**
 * Returns null when the key is missing, the payload is malformed, or the
 * authentication tag fails. Never throws — a bad row must not take down
 * resume-on-boot for every other run.
 */
export function decrypt(payload: string | null | undefined): string | null {
  if (!payload) return null;
  const k = key();
  if (!k) return null;
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== PREFIX) return null;
  try {
    const [, ivB64, tagB64, dataB64] = parts;
    const decipher = createDecipheriv(ALGO, k, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

/** True for anything encrypt() produced — used to spot legacy plaintext rows. */
export function isEncrypted(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(`${PREFIX}:`) && value.split(':').length === 4;
}
