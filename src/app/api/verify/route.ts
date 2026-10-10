import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Stable ordering so (A,B) and (B,A) are the same row. */
function orderedPair(a: string, b: string): [string, string] {
  return [a, b].sort() as [string, string];
}

type Status = 'unverified' | 'partial' | 'verified' | 'changed';

/**
 * GET /api/verify?peerId=&numberHash=
 *
 * Reports how far verification has progressed.
 *
 * Each side confirms independently, so there are four outcomes:
 *   unverified — neither side has compared
 *   partial    — exactly one side has compared ("50% verified")
 *   verified   — both have compared the same number
 *   changed    — a key changed since the comparison; verify again
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
      return NextResponse.json({ status: 'unverified', mineConfirmed: false, peerConfirmed: false });
    }

    const mineConfirmed = a === me.id ? record.verifiedA : record.verifiedB;
    const peerConfirmed = a === me.id ? record.verifiedB : record.verifiedA;

    // A key change outranks everything: the stored hash no longer describes
    // this conversation, so prior confirmations no longer apply.
    if (record.numberHash !== currentHash) {
      return NextResponse.json({
        status: 'changed',
        mineConfirmed,
        peerConfirmed,
      });
    }

    const status: Status =
      record.verifiedA && record.verifiedB
        ? 'verified'
        : record.verifiedA || record.verifiedB
          ? 'partial'
          : 'unverified';

    return NextResponse.json({
      status,
      mineConfirmed,
      peerConfirmed,
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
 * Records that THIS user compared the safety number.
 *
 * Only the caller's own flag is set. One person confirming never verifies the
 * conversation on its own — the other side has to do the same comparison.
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

    const peer = await db.user.findUnique({
      where: { id: peerId },
      select: { id: true, e2ePublicKey: true },
    });
    if (!peer?.e2ePublicKey) {
      return NextResponse.json({ error: 'Peer not found' }, { status: 404 });
    }

    const [a, b] = orderedPair(me.id, peerId);
    const iAmA = a === me.id;

    const existing = await db.verifiedKeyPair.findUnique({
      where: { userAId_userBId: { userAId: a, userBId: b } },
    });

    // Detect a key change: the stored hash no longer matches what we just
    // computed, so start a fresh confirmation rather than keeping stale flags.
    const keyChanged = existing && existing.numberHash !== numberHash;

    const myFlag = iAmA ? 'verifiedA' : 'verifiedB';
    const theirFlag = iAmA ? 'verifiedB' : 'verifiedA';

    const data = keyChanged
      ? {
          numberHash,
          [myFlag]: true,
          [theirFlag]: false,
          verifiedAt: null,
          updatedAt: new Date(),
        }
      : {
          [myFlag]: true,
          updatedAt: new Date(),
        };

    const record = await db.verifiedKeyPair.upsert({
      where: { userAId_userBId: { userAId: a, userBId: b } },
      create: {
        userAId: a,
        userBId: b,
        numberHash,
        [myFlag]: true,
      },
      update: data,
    });

    const fullyVerified = record.verifiedA && record.verifiedB;
    if (fullyVerified && !record.verifiedAt) {
      await db.verifiedKeyPair.update({
        where: { id: record.id },
        data: { verifiedAt: new Date() },
      });
    }

    return NextResponse.json({
      status: fullyVerified
        ? 'verified'
        : record[myFlag] && record[theirFlag]
          ? 'verified'
          : 'partial',
      mineConfirmed: true,
      peerConfirmed: fullyVerified,
      keyChanged,
    });
  } catch (error) {
    console.error('verify:mark failed', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE /api/verify?peerId=… — revoke this side's confirmation. */
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
    const iAmA = a === me.id;

    // Revoke only my own side: the other person's confirmation stays valid.
    await db.verifiedKeyPair
      .update({
        where: { userAId_userBId: { userAId: a, userBId: b } },
        data: { [iAmA ? 'verifiedA' : 'verifiedB']: false, verifiedAt: null },
      })
      .catch(() => {});

    return NextResponse.json({ status: 'unverified', mineConfirmed: false });
  } catch (error) {
    console.error('verify:revoke failed', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}