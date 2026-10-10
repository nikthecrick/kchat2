import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LINK_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * POST /api/verify-link
 *
 * Creates a shareable link that shows a safety number.
 *
 * What this is NOT: a link that verifies anything. Opening it only displays
 * the number. A bearer link that marked a conversation verified would be
 * forgeable by the server itself, which is precisely the attack safety numbers
 * exist to prevent. The link exists so the other person does not have to find
 * the conversation before they can read the number.
 */
export async function POST(request: NextRequest) {
  try {
    const me = await getSessionUser();
    if (!me) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { peerId, numberHash } = await request.json();

    if (typeof peerId !== 'string' || typeof numberHash !== 'string') {
      return NextResponse.json(
        { error: 'peerId and numberHash are required' },
        { status: 400 },
      );
    }
    if (peerId === me.id) {
      return NextResponse.json(
        { error: 'Cannot share a link for yourself' },
        { status: 400 },
      );
    }

    const peer = await db.user.findUnique({
      where: { id: peerId },
      select: { id: true, e2ePublicKey: true },
    });
    if (!peer?.e2ePublicKey) {
      return NextResponse.json(
        { error: 'That person has not published an encryption key yet' },
        { status: 404 },
      );
    }

    // One live link per peer; issuing a new one supersedes the old.
    await db.verifyLink
      .deleteMany({ where: { fromUserId: me.id, peerId } })
      .catch(() => {});

    const token = randomBytes(24).toString('base64url');
    const link = await db.verifyLink.create({
      data: {
        token,
        fromUserId: me.id,
        peerId,
        numberHash,
        expiresAt: new Date(Date.now() + LINK_TTL_MS),
      },
    });

    return NextResponse.json({ token: link.token, expiresAt: link.expiresAt });
  } catch (error) {
    console.error('verify-link:create failed', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}