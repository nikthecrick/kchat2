'use client';

/**
 * Safety numbers: the defence against a server that substitutes public keys.
 *
 * The attack this prevents: the server holds both users' public keys, so a
 * malicious one could hand Alice its own key in place of Bob's, decrypt her
 * traffic, and re-encrypt for Bob. Neither side would notice.
 *
 * The defence: both sides independently derive the same number from the pair
 * of public keys, and a human compares the two numbers through a channel the
 * server cannot observe (reading aloud, scanning a QR, or sending a screenshot
 * via another app). A substituted key changes the number on both sides
 * identically, so the mismatch becomes visible.
 *
 * Two properties matter for this to be worth anything:
 *
 *  1. It is computed in the BROWSER. The server never sees or influences it.
 *  2. It is order-independent (keys are sorted), because Alice and Bob derive
 *     it from opposite ends of the same conversation.
 *
 * What it does not protect against: verification is trust-on-first-verify. If
 * keys are substituted before anyone ever compares, those substituted numbers
 * get confirmed. Signal has the same property.
 */

const DIGIT_ALPHABET = '0123456789';
const GROUPS = 12;
const GROUP_SIZE = 5;
const TOTAL_DIGITS = GROUPS * GROUP_SIZE;

/**
 * Convert a hash digest into an even spread of digits.
 *
 * Each byte is reduced modulo 10. That bias is irrelevant here: the number is
 * only ever compared for equality, never used as a secret or as key material.
 */
function digestToDigits(digest: Uint8Array, length: number): string {
  let digits = '';
  for (let i = 0; i < length; i++) {
    digits += DIGIT_ALPHABET[digest[i % digest.length] % DIGIT_ALPHABET.length];
  }
  return digits;
}

/** SHA-256, working in both browsers and Node (server-side rendering). */
function sha256Sync(input: string): Uint8Array {
  // Node path (SSR, or a route handler importing this module).
  if (typeof window === 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeCrypto = require('crypto') as typeof import('crypto');
    return new Uint8Array(
      nodeCrypto.createHash('sha256').update(input, 'utf8').digest(),
    );
  }

  // Browser path. SubtleCrypto has no synchronous variant, so this module
  // cannot be fully isomorphic without giving up sync. Rather than a
  // half-implemented fallback we throw loudly — the dialog only derives numbers
  // after mount, so this path is never actually taken in the App Router.
  throw new Error(
    'deriveSafetyNumber must run in a browser effect; use deriveSafetyNumberAsync instead.',
  );
}

/**
 * Two public keys, each base64. Order does not matter.
 *
 * Synchronous, and server-safe. Call from an effect or event handler.
 */
export function deriveSafetyNumber(
  myPublicKey: string,
  theirPublicKey: string,
): string {
  const [a, b] = [myPublicKey, theirPublicKey].sort();

  // "kchat-safety-v1" provides domain separation, so these bytes can never be
  // confused with a hash over the same keys for some other purpose.
  const material = `kchat-safety-v1|${a}|${b}`;
  return digestToDigits(sha256Sync(material), TOTAL_DIGITS);
}

/** Browser-safe variant using Web Crypto. */
export async function deriveSafetyNumberAsync(
  myPublicKey: string,
  theirPublicKey: string,
): Promise<string> {
  const [a, b] = [myPublicKey, theirPublicKey].sort();
  const material = `kchat-safety-v1|${a}|${b}`;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(material),
  );
  return digestToDigits(new Uint8Array(digest), TOTAL_DIGITS);
}

/** Split into groups for reading aloud: "12345 67890 …" */
export function formatSafetyNumber(digits: string): string[] {
  const groups: string[] = [];
  for (let i = 0; i < digits.length; i += GROUP_SIZE) {
    groups.push(digits.slice(i, i + GROUP_SIZE));
  }
  return groups;
}

/**
 * Normalise whatever the other person typed or scanned into comparable digits.
 *
 * Accepts spaces, hyphens, and newlines, because a number read aloud or copied
 * out of a QR scanner will usually contain some of those.
 */
export function normaliseSafetyNumber(input: string): string {
  return input.replace(/\D/g, '').slice(0, TOTAL_DIGITS);
}

export function isCompleteSafetyNumber(input: string): boolean {
  return normaliseSafetyNumber(input).length === TOTAL_DIGITS;
}

export function safetyNumbersMatch(a: string, b: string): boolean {
  const left = normaliseSafetyNumber(a);
  const right = normaliseSafetyNumber(b);
  return left.length === right.length && left === right;
}