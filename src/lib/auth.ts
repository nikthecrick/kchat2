import { cookies } from 'next/headers';
// jsonwebtoken has no named `jwt` export; the callable is the default export.
import jwt from 'jsonwebtoken';
import { db } from '@/lib/db';

export const SESSION_COOKIE = 'kchat-session';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === 'change-me-before-deploying-anything') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET must be set to a real secret in production');
    }
  }
  return secret || 'insecure-development-only-secret';
}

export interface SessionUser {
  id: string;
  username: string | null;
  displayName: string;
  e2ePublicKey: string | null;
}

/** Anonymous users all share this label; usernames are explicitly non-unique. */
export const DEFAULT_USERNAME = 'Anonymous';

export function displayNameOf(username: string | null | undefined): string {
  const trimmed = username?.trim();
  return trimmed ? trimmed : DEFAULT_USERNAME;
}

export function createSessionToken(user: {
  id: string;
  username: string | null;
}): string {
  return jwt.sign({ userId: user.id }, jwtSecret(), {
    expiresIn: SESSION_TTL_SECONDS,
  });
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  };
}

/** Read + verify the session cookie. Returns null when absent or invalid. */
export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!token) return null;

    const decoded = jwt.verify(token, jwtSecret()) as { userId?: string };
    if (!decoded?.userId) return null;

    const user = await db.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        username: true,
        e2ePublicKey: true,
      },
    });
    if (!user) return null;

    return {
      id: user.id,
      username: user.username,
      displayName: displayNameOf(user.username),
      e2ePublicKey: user.e2ePublicKey,
    };
  } catch {
    return null;
  }
}