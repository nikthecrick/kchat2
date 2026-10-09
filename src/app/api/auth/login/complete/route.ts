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
 * Finish login.
 *
 * The caller sends no user id — the user is resolved purely from the
 * credential id inside the signed assertion, which is what makes the passkey
 * the actual identity rather than a secondary credential bolted onto an email.
 */
export async function POST(request: NextRequest) {
  try {
    const { credential, challenge } = await request.json();

    if (!credential || !challenge) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 },
      );
    }

    await webAuthnService.consumeAuthenticationChallenge(challenge);

    const { user, counter } = await webAuthnService.verifyAuthentication(
      credential,
      challenge,
    );

    await db.user.update({
      where: { id: user.id },
      data: { passkeyCounter: BigInt(counter) },
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
    const message =
      error instanceof Error ? error.message : 'Authentication failed';
    return NextResponse.json({ error: message }, { status: 401 });
  }
}