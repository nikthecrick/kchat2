import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { webAuthnService } from '@/lib/webauthn';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Begin registration.
 *
 * Username is optional and NOT unique. The passkey is the identity, so this
 * endpoint does not need a unique handle and two people may both be called
 * "Anonymous".
 *
 * The user row is created here but left without a passkey. If the user
 * abandons the browser prompt they simply have no passkey, and re-registering
 * with the same username is allowed — the old code hard-blocked this with
 * "User already exists", permanently stranding anyone who dismissed the dialog.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const rawUsername = typeof body.username === 'string' ? body.username.trim() : '';
    const e2ePublicKey =
      typeof body.e2ePublicKey === 'string' ? body.e2ePublicKey : null;

    if (rawUsername.length > 40) {
      return NextResponse.json(
        { error: 'Username must be 40 characters or fewer' },
        { status: 400 },
      );
    }
    if (e2ePublicKey && e2ePublicKey.length > 512) {
      return NextResponse.json({ error: 'Invalid key' }, { status: 400 });
    }

    await webAuthnService.purgeExpiredChallenges();

    // Reuse an abandoned account that has no passkey yet, otherwise clean up
    // any other passkey-less rows so retries don't pile up.
    const orphan = await db.user.findFirst({
      where: { passkeyCredentialId: null },
      orderBy: { createdAt: 'desc' },
    });
    if (orphan) {
      await db.user.delete({ where: { id: orphan.id } }).catch(() => {});
    }

    const user = await db.user.create({
      data: {
        username: rawUsername || null,
        e2ePublicKey,
      },
    });

    const options = await webAuthnService.createRegistrationChallenge(
      user.id,
      rawUsername || 'Anonymous',
    );

    return NextResponse.json({ options, userId: user.id });
  } catch (error) {
    console.error('register:start failed', error);
    return NextResponse.json(
      { error: 'Could not start registration' },
      { status: 500 },
    );
  }
}