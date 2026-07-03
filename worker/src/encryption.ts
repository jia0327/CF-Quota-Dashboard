import type { Env } from './types';

export type EncryptionContext = Pick<Env, 'PASSWORD' | 'ENCRYPTION_KEY'>;

const ENCRYPTED_PREFIX = 'enc:v1:';
const PBKDF2_SALT = 'cf-quota-dashboard:kv-encryption:v1';
const PBKDF2_ITERATIONS = 100_000;

export function isEncryptedValue(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function parseHexKey(hex: string): Uint8Array | null {
  const trimmed = hex.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) return null;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function sha256Bytes(text: string): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return new Uint8Array(hash);
}

async function importAesKey(rawKey: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function deriveKeyFromPassword(password: string): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: new TextEncoder().encode(PBKDF2_SALT),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  );
  return importAesKey(new Uint8Array(bits));
}

async function resolveAesKey(ctx: EncryptionContext): Promise<CryptoKey | null> {
  const explicit = ctx.ENCRYPTION_KEY?.trim();
  if (explicit) {
    const hexKey = parseHexKey(explicit);
    const raw = hexKey ?? (await sha256Bytes(explicit));
    return importAesKey(raw);
  }

  const password = ctx.PASSWORD?.trim();
  if (password) return deriveKeyFromPassword(password);

  return null;
}

export function hasEncryptionKey(ctx?: EncryptionContext): boolean {
  if (!ctx) return false;
  return Boolean(ctx.ENCRYPTION_KEY?.trim() || ctx.PASSWORD?.trim());
}

export async function encryptField(value: string, ctx?: EncryptionContext): Promise<string> {
  if (!value || !ctx || !hasEncryptionKey(ctx) || isEncryptedValue(value)) return value;

  const key = await resolveAesKey(ctx);
  if (!key) return value;

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(value),
  );

  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return `${ENCRYPTED_PREFIX}${bytesToBase64(combined)}`;
}

export async function decryptField(value: string, ctx?: EncryptionContext): Promise<string> {
  if (!value || !isEncryptedValue(value)) return value;
  if (!ctx || !hasEncryptionKey(ctx)) return value;

  const key = await resolveAesKey(ctx);
  if (!key) return value;

  try {
    const combined = base64ToBytes(value.slice(ENCRYPTED_PREFIX.length));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return new TextDecoder().decode(plaintext);
  } catch {
    return value;
  }
}
