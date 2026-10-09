import { NextRequest, NextResponse } from 'next/server';
import { webAuthnService } from '@/lib/webauthn';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Begin login.
 *
 * There is deliberately no username or email parameter. A discoverable
 * (resident) credential request returns an empty allowCredentials list, so the
 * browser displays its own passkey picker and tells us which credential was
 * used. The user types nothing.
 */
export async function POST() {
  try {
    await webAuthnService.purgeExpiredChallenges();
    const options = await webAuthnService.createAuthenticationChallenge();
    return NextResponse.json({ options });
  } catch (error) {
    console.error('login:start failed', error);
    return NextResponse.json(
      { error: 'Could not start login' },
      { status: 500 },
    );
  }
}