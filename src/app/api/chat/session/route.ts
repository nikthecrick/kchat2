import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser, displayNameOf } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Start (or reopen) a 1:1 conversation with another user. */
export async function POST(request: NextRequest) {
  try {
    const me = await getSessionUser();
    if (!me) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { participantId } = await request.json();
    if (!participantId || participantId === me.id) {
      return NextResponse.json(
        { error: 'Choose someone else to chat with' },
        { status: 400 },
      );
    }

    const other = await db.user.findUnique({
      where: { id: participantId },
      select: { id: true, username: true, e2ePublicKey: true, passkeyCredentialId: true },
    });

    if (!other?.passkeyCredentialId) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Always store the pair in sorted order so the @@unique constraint actually
    // prevents duplicate sessions. Without this, A→B and B→A produce two rows.
    const [p1, p2] = [me.id, other.id].sort();

    const existing = await db.chatSession.findUnique({
      where: { participant1Id_participant2Id: { participant1Id: p1, participant2Id: p2 } },
      include: { messages: { orderBy: { timestamp: 'desc' }, take: 1 } },
    });

    const peer = {
      id: other.id,
      username: other.username,
      displayName: displayNameOf(other.username),
      // Only the public half is ever exposed — never a private key.
      publicKey: other.e2ePublicKey,
    };

    if (existing) {
      return NextResponse.json({
        session: { id: existing.id, peer },
        isExisting: true,
      });
    }

    const created = await db.chatSession.create({
      data: { participant1Id: p1, participant2Id: p2 },
    });

    return NextResponse.json({
      session: { id: created.id, peer },
      isExisting: false,
    });
  } catch (error) {
    console.error('chat/session:create failed', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** All conversations for the current user, most recently active first. */
export async function GET() {
  try {
    const me = await getSessionUser();
    if (!me) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sessions = await db.chatSession.findMany({
      where: { OR: [{ participant1Id: me.id }, { participant2Id: me.id }] },
      include: {
        participant1: { select: { id: true, username: true, e2ePublicKey: true } },
        participant2: { select: { id: true, username: true, e2ePublicKey: true } },
        messages: { orderBy: { timestamp: 'desc' }, take: 1 },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return NextResponse.json({
      sessions: sessions.map((s) => {
        const peer = s.participant1Id === me.id ? s.participant2 : s.participant1;
        return {
          id: s.id,
          peer: {
            id: peer.id,
            username: peer.username,
            displayName: displayNameOf(peer.username),
            publicKey: peer.e2ePublicKey,
          },
          updatedAt: s.updatedAt,
          lastMessageAt: s.messages[0]?.timestamp ?? null,
        };
      }),
    });
  } catch (error) {
    console.error('chat/session:list failed', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

