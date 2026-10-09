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

    // Clean up abandoned accounts from earlier attempts. Only rows older than
    // ten minutes are eligible: deleting every passkey-less user outright would
    // break two people registering at the same time, since the second request
    // would wipe out the first one's pending account.
    const staleBefore = new Date(Date.now() - 10 * 60 * 1000);
    const orphans = await db.user.findMany({
      where: { passkeyCredentialId: null, createdAt: { lt: staleBefore } },
      select: { id: true },
    });
    for (const orphan of orphans) {
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
    // Returning a generic message here made this impossible to diagnose from
    // the browser. Surface the real cause — it is almost always a missing
    // migration or an unset ORIGIN/RP_ID. See /api/health.
    const message =
      error instanceof Error ? error.message : 'Unknown registration error';
    console.error('register:start failed', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}