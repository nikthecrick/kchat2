import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Store an already-encrypted message.
 *
 * The server receives ciphertext it cannot read. There is no ratchet state in
 * the payload and none on the server: the old design had the client POST its
 * Double Ratchet state to the server on every message, which meant the server
 * held enough material to derive the keys it was supposed to be blind to.
 */
export async function POST(request: NextRequest) {
  try {
    const me = await getSessionUser();
    if (!me) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { chatSessionId, ciphertext } = await request.json();

    if (!chatSessionId || typeof ciphertext !== 'string' || !ciphertext) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    if (ciphertext.length > 20000) {
      return NextResponse.json({ error: 'Message too large' }, { status: 413 });
    }

    const session = await db.chatSession.findUnique({
      where: { id: chatSessionId },
      select: { participant1Id: true, participant2Id: true },
    });
    if (!session) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
    }
    if (session.participant1Id !== me.id && session.participant2Id !== me.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const receiverId =
      session.participant1Id === me.id ? session.participant2Id : session.participant1Id;

    const message = await db.message.create({
      data: { chatSessionId, senderId: me.id, receiverId, ciphertext },
      select: { id: true, senderId: true, chatSessionId: true, timestamp: true },
    });

    // Bump the session so it sorts to the top of the sidebar.
    await db.chatSession.update({
      where: { id: chatSessionId },
      data: { updatedAt: new Date() },
    });

    return NextResponse.json({ message });
  } catch (error) {
    console.error('chat/messages:send failed', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** Fetch the ciphertext history for one conversation. */
export async function GET(request: NextRequest) {
  try {
    const me = await getSessionUser();
    if (!me) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const chatSessionId = request.nextUrl.searchParams.get('chatSessionId');
    if (!chatSessionId) {
      return NextResponse.json({ error: 'chatSessionId is required' }, { status: 400 });
    }

    const session = await db.chatSession.findUnique({
      where: { id: chatSessionId },
      select: { participant1Id: true, participant2Id: true },
    });
    if (!session) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
    }
    if (session.participant1Id !== me.id && session.participant2Id !== me.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const messages = await db.message.findMany({
      where: { chatSessionId },
      select: { id: true, senderId: true, ciphertext: true, timestamp: true },
      orderBy: { timestamp: 'asc' },
      take: 500,
    });

    return NextResponse.json({ messages });
  } catch (error) {
    console.error('chat/messages:list failed', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}