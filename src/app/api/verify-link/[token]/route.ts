import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/verify-link/[token]
 *
 * Returns the key material needed to DISPLAY a safety number.
 *
 * Note what it deliberately does not do: it does not mark anything verified,
 * and it does not require authentication. Anyone holding the link can read the
 * two public keys and compute the number — which is the point. Both public keys
 * are public by design; the link merely saves hunting for them. The security of
 * verification rests on the two humans comparing what they each see, never on
 * who can load this endpoint.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;

    const link = await db.verifyLink.findUnique({ where: { token } });
    if (!link) {
      return NextResponse.json({ error: 'Link not found' }, { status: 404 });
    }
    if (link.expiresAt < new Date()) {
      return NextResponse.json({ error: 'Link expired' }, { status: 410 });
    }

    const fromUser = await db.user.findUnique({
      where: { id: link.fromUserId },
      select: { id: true, username: true, e2ePublicKey: true },
    });
    const toUser = await db.user.findUnique({
      where: { id: link.peerId },
      select: { id: true, username: true, e2ePublicKey: true },
    });

    if (!fromUser?.e2ePublicKey || !toUser?.e2ePublicKey) {
      return NextResponse.json(
        { error: 'One party has not published an encryption key' },
        { status: 409 },
      );
    }

    return NextResponse.json({
      fromUser: {
        id: fromUser.id,
        name: fromUser.username || 'Anonymous',
        publicKey: fromUser.e2ePublicKey,
      },
      toUser: {
        id: toUser.id,
        name: toUser.username || 'Anonymous',
        publicKey: toUser.e2ePublicKey,
      },
      expiresAt: link.expiresAt,
    });
  } catch (error) {
    console.error('verify-link:read failed', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}