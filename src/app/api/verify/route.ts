import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Stable ordering so (A,B) and (B,A) are the same row. */
function orderedPair(a: string, b: string): [string, string] {
  return [a, b].sort() as [string, string];
}

/**
 * GET /api/verify?peerId=…
 *
 * Reports whether the current user has verified the peer, and whether the
 * peer's public key still matches what was verified.
 *
 * The client sends the hash of the safety number it just computed. If that
 * differs from the stored hash, one of the keys changed since verification —
 * a legitimate reason would be the peer moving to a new device, and an illegitimate
 * one would be a server substituting a key. Either way the user should be told.
 */
export async function GET(request: NextRequest) {
  try {
    const me = await getSessionUser();
    if (!me) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const peerId = request.nextUrl.searchParams.get('peerId');
    const currentHash = request.nextUrl.searchParams.get('numberHash');

    if (!peerId || !currentHash) {
      return NextResponse.json(
        { error: 'peerId and numberHash are required' },
        { status: 400 },
      );
    }
    if (peerId === me.id) {
      return NextResponse.json({ error: 'Cannot verify yourself' }, { status: 400 });
    }

    const [a, b] = orderedPair(me.id, peerId);
    const record = await db.verifiedKeyPair.findUnique({
      where: { userAId_userBId: { userAId: a, userBId: b } },
    });

    if (!record) {
      return NextResponse.json({ status: 'unverified' });
    }

    const keyChanged = record.numberHash !== currentHash;

    return NextResponse.json({
      status: keyChanged ? 'changed' : 'verified',
      verifiedAt: record.verifiedAt,
    });
  } catch (error) {
    console.error('verify:get failed', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/verify
 *
 * Records that the user compared the safety number for a conversation.
 *
 * The server is told a hash, never the number, and cannot influence how the
 * number is derived. It also does not mark the *peer* as verified: each side
 * confirms independently, since one of the two may never open the app.
 */
export async function POST(request: NextRequest) {
  try {
    const me = await getSessionUser();
    if (!me) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { peerId, numberHash } = await request.json();

    if (
      typeof peerId !== 'string' ||
      typeof numberHash !== 'string' ||
      !/^[0-9a-f]{64}$/.test(numberHash)
    ) {
      return NextResponse.json(
        { error: 'peerId and a hex numberHash are required' },
        { status: 400 },
      );
    }
    if (peerId === me.id) {
      return NextResponse.json({ error: 'Cannot verify yourself' }, { status: 400 });
    }

    // The peer must actually exist and have a public key, otherwise this is a
    // row pointing at nothing.
    const peer = await db.user.findUnique({
      where: { id: peerId },
      select: { id: true, e2ePublicKey: true },
    });
    if (!peer?.e2ePublicKey) {
      return NextResponse.json({ error: 'Peer not found' }, { status: 404 });
    }

    const [a, b] = orderedPair(me.id, peerId);
    const record = await db.verifiedKeyPair.upsert({
      where: { userAId_userBId: { userAId: a, userBId: b } },
      create: { userAId: a, userBId: b, numberHash },
      update: { numberHash, verifiedAt: new Date() },
    });

    return NextResponse.json({
      status: 'verified',
      verifiedAt: record.verifiedAt,
    });
  } catch (error) {
    console.error('verify:mark failed', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE /api/verify?peerId=… — revoke a verification. */
export async function DELETE(request: NextRequest) {
  try {
    const me = await getSessionUser();
    if (!me) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const peerId = request.nextUrl.searchParams.get('peerId');
    if (!peerId) {
      return NextResponse.json({ error: 'peerId is required' }, { status: 400 });
    }

    const [a, b] = orderedPair(me.id, peerId);
    await db.verifiedKeyPair
      .delete({ where: { userAId_userBId: { userAId: a, userBId: b } } })
      .catch(() => {});

    return NextResponse.json({ status: 'unverified' });
  } catch (error) {
    console.error('verify:revoke failed', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}