import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { webAuthnService } from '@/lib/webauthn';
import {
  createSessionToken,
  displayNameOf,
  SESSION_COOKIE,
  sessionCookieOptions,
} from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Finish registration and log the user in immediately.
 *
 * The challenge is looked up in the database rather than trusted from the
 * request body. The previous implementation had the client POST back the
 * challenge it had already been issued, so the value being verified was chosen
 * by the party being verified.
 */
export async function POST(request: NextRequest) {
  let pendingUserId: string | null = null;

  try {
    const { credential, challenge } = await request.json();

    if (!credential || !challenge) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 },
      );
    }

    const userId = await webAuthnService.consumeRegistrationChallenge(challenge);
    pendingUserId = userId;

    const { credentialId, publicKey, counter } =
      await webAuthnService.verifyRegistration(credential, challenge);

    const user = await db.user.update({
      where: { id: userId },
      data: {
        passkeyCredentialId: credentialId,
        passkeyPublicKey: publicKey,
        passkeyCounter: BigInt(counter),
      },
      select: { id: true, username: true, e2ePublicKey: true },
    });

    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        displayName: displayNameOf(user.username),
      },
    });
    response.cookies.set(
      SESSION_COOKIE,
      createSessionToken({ id: user.id, username: user.username }),
      sessionCookieOptions(),
    );
    return response;
  } catch (error) {
    // Don't strand a half-registered account if the passkey step failed.
    if (pendingUserId) {
      await db.user
        .delete({ where: { id: pendingUserId } })
        .catch(() => {});
    }

    const message =
      error instanceof Error ? error.message : 'Registration failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}