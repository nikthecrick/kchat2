'use client';

import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';

export interface RegisterOptions {
  options: PublicKeyCredentialCreationOptionsJSON;
}

export interface AuthenticateOptions {
  options: PublicKeyCredentialRequestOptionsJSON;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'NotAllowedError') {
      return 'Passkey prompt was dismissed or timed out.';
    }
    if (error.name === 'InvalidStateError') {
      return 'A passkey already exists for this account on this device.';
    }
    if (error.name === 'NotSupportedError') {
      return 'This browser does not support passkeys.';
    }
    return error.message;
  }
  return 'Unknown error';
}

/** Thrown when the user closes the native prompt, so callers can stay quiet. */
export class PasskeyCancelledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PasskeyCancelledError';
  }
}

export async function registerPasskey(
  options: RegisterOptions,
): Promise<RegistrationResponseJSON> {
  try {
    return await startRegistration({ optionsJSON: options.options });
  } catch (error) {
    const message = describeError(error);
    if (message.includes('dismissed')) {
      throw new PasskeyCancelledError(message);
    }
    throw new Error(message);
  }
}

export async function authenticatePasskey(
  options: AuthenticateOptions,
): Promise<AuthenticationResponseJSON> {
  try {
    // allowCredentials is empty, so the browser renders its own account picker.
    return await startAuthentication({ optionsJSON: options.options });
  } catch (error) {
    const message = describeError(error);
    if (message.includes('dismissed')) {
      throw new PasskeyCancelledError(message);
    }
    throw new Error(message);
  }
}

export interface PasskeySupport {
  supported: boolean;
  reason?: string;
}

/**
 * Explains *why* passkeys are unavailable rather than just returning a bool.
 * The overwhelmingly common cause is a non-secure origin: WebAuthn is only
 * exposed on https, with localhost treated as secure. Browsing to a LAN IP or
 * to http://0.0.0.0:3000 therefore removes window.PublicKeyCredential entirely.
 */
export function getPasskeySupport(): PasskeySupport {
  if (typeof window === 'undefined') {
    return { supported: false, reason: 'Waiting for the browser…' };
  }

  if (!window.isSecureContext) {
    return {
      supported: false,
      reason:
        'This page is not a secure context. Passkeys only work over HTTPS, or on exactly "localhost".',
    };
  }

  if (typeof window.PublicKeyCredential === 'undefined') {
    return {
      supported: false,
      reason: 'This browser does not implement WebAuthn.',
    };
  }

  if (
    typeof navigator.credentials?.create !== 'function' ||
    typeof navigator.credentials?.get !== 'function'
  ) {
    return {
      supported: false,
      reason: 'The Web Credentials API is unavailable in this browser.',
    };
  }

  return { supported: true };
}

export function isPasskeySupported(): boolean {
  return getPasskeySupport().supported;
}