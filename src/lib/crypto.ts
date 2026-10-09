/**
 * Client-side encryption for KChat.
 *
 * This module is browser-only. It runs in the user's tab; the server is never
 * given the private key and therefore cannot read any message.
 *
 * Scheme (simple and honest, rather than a half-implemented ratchet):
 *   - Each user generates one X25519 keypair with nacl.box.keyPair().
 *   - The public half is uploaded to the server; the secret half is kept in
 *     localStorage and never transmitted.
 *   - For each conversation we derive a 32-byte shared key via X25519.
 *   - Each message is sealed with secretbox (XSalsa20-Poly1305) under a fresh
 *     random 24-byte nonce, prepended to the ciphertext.
 *
 * Security properties this actually has: confidentiality and authenticity
 * between the two parties, and the server cannot decrypt. It does NOT have
 * forward secrecy — a compromised long-term key can decrypt history. Achieving
 * real forward secrecy requires a proper Double Ratchet implementation with
 * per-device keys and out-of-band prekey delivery, which is a much larger
 * project than this one.
 */
import nacl from 'tweetnacl';

const PRIVATE_KEY_STORAGE = 'kchat.e2e.privateKey';

export interface KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function generateKeyPair(): KeyPair {
  const kp = nacl.box.keyPair();
  return { publicKey: kp.publicKey, privateKey: kp.secretKey };
}

/** Returns the private key for this browser, creating one on first run. */
export function getOrCreateLocalKeyPair(): KeyPair {
  if (typeof window === 'undefined') {
    throw new Error('Encryption keys are only available in the browser');
  }

  const stored = window.localStorage.getItem(PRIVATE_KEY_STORAGE);
  if (stored) {
    try {
      const privateKey = fromBase64(stored);
      // tweetnacl names the secret half `secretKey`; the lookup helper lives on
      // nacl.box.keyPair (not on nacl.box directly).
      const kp = nacl.box.keyPair.fromSecretKey(privateKey);
      return { publicKey: kp.publicKey, privateKey: kp.secretKey };
    } catch {
      window.localStorage.removeItem(PRIVATE_KEY_STORAGE);
    }
  }

  const pair = generateKeyPair();
  window.localStorage.setItem(PRIVATE_KEY_STORAGE, toBase64(pair.privateKey));
  return pair;
}

export function exportPublicKey(publicKey: Uint8Array): string {
  return toBase64(publicKey);
}

/** Hash used to fingerprint a safety number for server-side comparison. */
export async function hashString(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function importPublicKey(value: string): Uint8Array {
  return fromBase64(value);
}

/** X25519 scalar multiplication -> a usable 32-byte symmetric key. */
function deriveSharedKey(
  myPrivateKey: Uint8Array,
  theirPublicKey: Uint8Array,
): Uint8Array {
  return nacl.scalarMult(myPrivateKey, theirPublicKey);
}

/** Encrypt for a specific recipient. Output is base64(nonce || ciphertext). */
export function encryptFor(
  plaintext: string,
  myPrivateKey: Uint8Array,
  theirPublicKey: Uint8Array,
): string {
  const key = deriveSharedKey(myPrivateKey, theirPublicKey);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const ciphertext = nacl.secretbox(
    encoder.encode(plaintext),
    nonce,
    key,
  );
  const payload = new Uint8Array(nonce.length + ciphertext.length);
  payload.set(nonce, 0);
  payload.set(ciphertext, nonce.length);
  return toBase64(payload);
}

export function decryptFrom(
  payloadBase64: string,
  myPrivateKey: Uint8Array,
  theirPublicKey: Uint8Array,
): string {
  const payload = fromBase64(payloadBase64);
  const nonceLength = nacl.secretbox.nonceLength;
  if (payload.length <= nonceLength) {
    throw new Error('Malformed ciphertext');
  }

  const nonce = payload.subarray(0, nonceLength);
  const ciphertext = payload.subarray(nonceLength);
  const key = deriveSharedKey(myPrivateKey, theirPublicKey);

  const plaintext = nacl.secretbox.open(ciphertext, nonce, key);
  if (!plaintext) {
    throw new Error('Unable to decrypt message');
  }
  return decoder.decode(plaintext);
}