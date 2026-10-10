import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUS = { PENDING: 'pending', SEEN: 'seen', COMPLETED: 'completed' } as const;

/**
 * GET /api/verify-request
 *
 * Lists verification requests involving the current user, newest first.
 *
 * Note what this is NOT: a completed request does not verify anything. It only
 * records that both people were walked through the comparison. The security
 * property comes from the digits being compared out of band, and that is
 * recorded separately via POST /api/verify.
 */
export async function GET() {
  try {
    const me = await getSessionUser();
    if (!me) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const requests = await db.verificationRequest.findMany({
      where: {
        OR: [{ fromUserId: me.id }, { toUserId: me.id }],
      },
      include: {
        fromUser: { select: { id: true, username: true } },
        toUser: { select: { id: true, username: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return NextResponse.json({
      requests: requests.map((r) => ({
        id: r.id,
        peerId: r.fromUserId === me.id ? r.toUserId : r.fromUserId,
        peerName:
          (r.fromUserId === me.id ? r.toUser.username : r.fromUser.username) ||
          'Anonymous',
        direction: r.fromUserId === me.id ? 'sent' : 'received',
        status: r.status,
        numberHash: r.numberHash,
        createdAt: r.createdAt,
      })),
    });
  } catch (error) {
    console.error('verify-request:list failed', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/verify-request
 *
 * Ask the other person to verify a conversation. Creates at most one pending
 * request per direction so repeated clicks cannot spam the other side.
 */
export async function POST(request: NextRequest) {
  try {
    const me = await getSessionUser();
    if (!me) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { peerId, numberHash, chatSessionId } = await request.json();

    if (typeof peerId !== 'string' || typeof numberHash !== 'string') {
      return NextResponse.json(
        { error: 'peerId and numberHash are required' },
        { status: 400 },
      );
    }
    if (peerId === me.id) {
      return NextResponse.json(
        { error: 'Cannot request verification from yourself' },
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

    const existing = await db.verificationRequest.findFirst({
      where: {
        fromUserId: me.id,
        toUserId: peerId,
        numberHash,
        status: { in: [STATUS.PENDING, STATUS.SEEN] },
      },
    });
    if (existing) {
      return NextResponse.json({ request: existing, isExisting: true });
    }

    const created = await db.verificationRequest.create({
      data: {
        fromUserId: me.id,
        toUserId: peerId,
        numberHash,
        chatSessionId:
          typeof chatSessionId === 'string' ? chatSessionId : null,
      },
    });

    return NextResponse.json({ request: created, isExisting: false });
  } catch (error) {
    console.error('verify-request:create failed', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PUT /api/verify-request
 *
 * Advance a request: "seen" when the other person opens it, "completed" when
 * they have finished their comparison. Completing does NOT verify anything —
 * the sender still has to run their own comparison.
 */
export async function PUT(request: NextRequest) {
  try {
    const me = await getSessionUser();
    if (!me) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id, status } = await request.json();

    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    if (status !== STATUS.SEEN && status !== STATUS.COMPLETED) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const record = await db.verificationRequest.findUnique({
      where: { id },
    });
    if (!record) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }
    // Only the recipient may advance it.
    if (record.toUserId !== me.id) {
      return NextResponse.json({ error: 'Not your request' }, { status: 403 });
    }

    // Completed is terminal.
    if (record.status === STATUS.COMPLETED && status === STATUS.SEEN) {
      return NextResponse.json({ request: record });
    }

    const updated = await db.verificationRequest.update({
      where: { id },
      data: { status, updatedAt: new Date() },
    });

    return NextResponse.json({ request: updated });
  } catch (error) {
    console.error('verify-request:update failed', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE /api/verify-request?id=… — cancel a request you sent. */
export async function DELETE(request: NextRequest) {
  try {
    const me = await getSessionUser();
    if (!me) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const id = request.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const record = await db.verificationRequest.findUnique({ where: { id } });
    if (record && record.fromUserId !== me.id) {
      return NextResponse.json({ error: 'Not your request' }, { status: 403 });
    }

    await db.verificationRequest.delete({ where: { id } }).catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('verify-request:cancel failed', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}