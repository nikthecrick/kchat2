import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
// NOTE: there is no `@simplewebauthn/types` package at v13 — it was discontinued
// after v12 and the types now ship inside the server/browser packages. Importing
// it (as the old code did) is an unsatisfiable dependency and broke the build.
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { db } from '@/lib/db';

const RP_NAME = 'KChat';

function getConfig() {
  const nodeEnv = process.env.NODE_ENV;
  const rpID = process.env.RP_ID ?? 'localhost';
  const origin =
    process.env.ORIGIN ?? (nodeEnv === 'production' ? '' : 'http://localhost:3000');

  if (!rpID || !origin) {
    throw new Error(
      'WebAuthn is misconfigured: set RP_ID and ORIGIN in your environment.',
    );
  }
  return { rpID, origin, rpName: RP_NAME };
}

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export class WebAuthnService {
  private config() {
    return getConfig();
  }

  async purgeExpiredChallenges() {
    await db.webAuthnChallenge.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
  }

  /** Generate + persist a challenge. Returns the options for the browser. */
  async createRegistrationChallenge(userId: string, username: string) {
    const { rpID, rpName } = this.config();
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: new TextEncoder().encode(user.id),
      // Usernames are display labels and may collide, so the unique user.id
      // (not the username) must be the WebAuthn user handle.
      userName: `${username}-${user.id.slice(-8)}`,
      userDisplayName: username,
      timeout: 60000,
      attestationType: 'none',
      excludeCredentials: user.passkeyCredentialId
        ? [{ id: user.passkeyCredentialId }]
        : [],
      authenticatorSelection: {
        residentKey: 'required',
        // "required" so passkeys are bound to the device — this is what makes
        // usernameless login possible later.
        userVerification: 'required',
      },
    });

    await db.webAuthnChallenge.create({
      data: {
        challenge: options.challenge,
        type: 'registration',
        userId,
        expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
      },
    });

    return options;
  }

  async createAuthenticationChallenge() {
    const { rpID } = this.config();

    // allowCredentials stays EMPTY on purpose. This is a "discoverable
    // credential" login: the browser shows its own native passkey picker and
    // the response tells us which credential was used. That's what lets login
    // work with no username at all.
    const options = await generateAuthenticationOptions({
      rpID,
      timeout: 60000,
      allowCredentials: [],
      userVerification: 'required',
    });

    await db.webAuthnChallenge.create({
      data: {
        challenge: options.challenge,
        type: 'authentication',
        userId: null,
        expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
      },
    });

    return options;
  }

  /**
   * Verify a registration against a challenge we issued, then delete it.
   * Single-use: prevents replay of a completed ceremony.
   */
  async consumeRegistrationChallenge(challenge: string) {
    const record = await db.webAuthnChallenge.findUnique({ where: { challenge } });
    if (!record || record.type !== 'registration') {
      throw new Error('Unknown or already-used registration challenge');
    }
    if (record.expiresAt < new Date()) {
      await db.webAuthnChallenge.delete({ where: { id: record.id } }).catch(() => {});
      throw new Error('Registration challenge expired — please try again');
    }
    await db.webAuthnChallenge.delete({ where: { id: record.id } });
    return record.userId!;
  }

  async consumeAuthenticationChallenge(challenge: string) {
    const record = await db.webAuthnChallenge.findUnique({ where: { challenge } });
    if (!record || record.type !== 'authentication') {
      throw new Error('Unknown or already-used authentication challenge');
    }
    if (record.expiresAt < new Date()) {
      await db.webAuthnChallenge.delete({ where: { id: record.id } }).catch(() => {});
      throw new Error('Authentication challenge expired — please try again');
    }
    await db.webAuthnChallenge.delete({ where: { id: record.id } });
    return record;
  }

  async verifyRegistration(
    response: RegistrationResponseJSON,
    challenge: string,
  ) {
    const { rpID, origin } = this.config();

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      throw new Error('Passkey registration could not be verified');
    }

    const { registrationInfo } = verification;
    const { id, publicKey, counter } = registrationInfo.credential;

    return {
      credentialId: id,
      publicKey: Buffer.from(publicKey).toString('base64'),
      counter,
    };
  }

  async verifyAuthentication(
    response: AuthenticationResponseJSON,
    challenge: string,
  ) {
    const { rpID, origin } = this.config();

    // Identity comes from the credential in the assertion, not from anything
    // the client claims. This is the core of the passkey-only model.
    const user = await db.user.findUnique({
      where: { passkeyCredentialId: response.id },
    });

    // Check passkeyCredentialId specifically: checking only the public key
    // leaves TS unable to prove the id is non-null, since the two are
    // independently nullable columns.
    if (!user?.passkeyCredentialId || !user.passkeyPublicKey) {
      throw new Error('This passkey is not registered');
    }

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: user.passkeyCredentialId,
        publicKey: new Uint8Array(Buffer.from(user.passkeyPublicKey, 'base64')),
        counter: Number(user.passkeyCounter ?? 0),
      },
    });

    if (!verification.verified) {
      throw new Error('Passkey authentication could not be verified');
    }

    return { user, counter: verification.authenticationInfo.newCounter };
  }
}

export const webAuthnService = new WebAuthnService();