import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser, DEFAULT_USERNAME } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * List users to start a conversation with.
 *
 * On the original SQLite setup this used `mode: 'insensitive'`, which Prisma
 * only supports on PostgreSQL and MongoDB — every search threw at runtime, so
 * the "find someone to chat with" box was permanently broken. It works now
 * that the database is PostgreSQL.
 *
 * Only users who actually have a passkey are returned — someone still
 * mid-registration is not yet discoverable.
 */
export async function GET(request: NextRequest) {
  try {
    const me = await getSessionUser();
    if (!me) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const query = (request.nextUrl.searchParams.get('q') ?? '').trim();

    const users = await db.user.findMany({
      where: {
        id: { not: me.id },
        passkeyCredentialId: { not: null },
        ...(query
          ? { username: { contains: query, mode: 'insensitive' } }
          : {}),
      },
      select: {
        id: true,
        username: true,
        createdAt: true,
        _count: { select: { chatSessions1: true, chatSessions2: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });

    return NextResponse.json({
      users: users.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.username || DEFAULT_USERNAME,
      })),
    });
  } catch (error) {
    console.error('users:list failed', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}