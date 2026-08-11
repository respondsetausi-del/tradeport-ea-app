import { test, expect, beforeAll } from 'bun:test';
import { encrypt, decrypt, isEncrypted, encryptionAvailable } from '../app/api/mt5/strategy/secrets';
import { buildTag, newRunId } from '../app/api/mt5/strategy/journal';

beforeAll(() => { process.env.CREDS_KEY = 'a-test-key-long-enough-to-be-accepted'; });

test('round-trips credentials', () => {
  const creds = JSON.stringify({ server: 'RazorMarkets-Live', login: '123456', password: 'p@ss word:with:colons' });
  const enc = encrypt(creds)!;
  expect(enc).not.toBeNull();
  expect(enc).not.toContain('p@ss');       // the point
  expect(decrypt(enc)).toBe(creds);
});

test('every encryption is different (fresh IV)', () => {
  expect(encrypt('same input')).not.toBe(encrypt('same input'));
});

test('a tampered payload fails to decrypt instead of returning garbage', () => {
  const enc = encrypt('secret')!;
  const parts = enc.split(':');
  const flipped = Buffer.from(parts[3], 'base64');
  flipped[0] ^= 0xff;
  parts[3] = flipped.toString('base64');
  expect(decrypt(parts.join(':'))).toBeNull();
});

test('decrypt never throws on rubbish', () => {
  expect(decrypt('not-a-payload')).toBeNull();
  expect(decrypt('')).toBeNull();
  expect(decrypt(null)).toBeNull();
  expect(decrypt('v1:a:b')).toBeNull();
});

test('isEncrypted distinguishes stored payloads from legacy plaintext', () => {
  expect(isEncrypted(encrypt('x'))).toBe(true);
  expect(isEncrypted('RazorMarkets-Live')).toBe(false);
  expect(isEncrypted(null)).toBe(false);
});

test('with no key: encrypt returns null so callers store nothing', () => {
  const saved = process.env.CREDS_KEY;
  delete process.env.CREDS_KEY;
  expect(encryptionAvailable()).toBe(false);
  expect(encrypt('secret')).toBeNull();
  process.env.CREDS_KEY = saved;
});

test('a short key is rejected rather than padded', () => {
  const saved = process.env.CREDS_KEY;
  process.env.CREDS_KEY = 'tooshort';
  expect(encryptionAvailable()).toBe(false);
  process.env.CREDS_KEY = saved;
});

// ── journal tags ──────────────────────────────────────────────────────────

test('order tags fit inside the 31-char MT5 comment limit', () => {
  expect(buildTag('Royd', 'a7f3', 12).length).toBeLessThanOrEqual(31);
  const long = buildTag('A Robot With A Very Long Name Indeed', 'a7f3', 9999);
  expect(long.length).toBeLessThanOrEqual(31);
  expect(long).toContain('#a7f39999');
});

test('tags stay unique per order and keep the robot name visible', () => {
  const a = buildTag('Royd', 'a7f3', 1);
  const b = buildTag('Royd', 'a7f3', 2);
  expect(a).not.toBe(b);
  expect(a.startsWith('Royd')).toBe(true);
});

test('run ids are short', () => {
  expect(newRunId(Date.now()).length).toBeLessThanOrEqual(4);
});
