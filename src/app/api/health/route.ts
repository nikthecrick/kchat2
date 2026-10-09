import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Deployment diagnostics.
 *
 * Registration failures were previously indistinguishable from the browser —
 * the client just saw "could not start registration". Hit this endpoint to see
 * whether the database is reachable, the tables exist (i.e. migrations were
 * applied), and the WebAuthn origin is configured.
 */
export async function GET() {
  const checks: Record<string, { ok: boolean; detail: string }> = {};

  const rpID = process.env.RP_ID ?? '(unset)';
  const origin = process.env.ORIGIN ?? '(unset)';
  checks.webauthnConfig = {
    ok: Boolean(process.env.ORIGIN && process.env.RP_ID),
    detail:
      `RP_ID=${rpID} ORIGIN=${origin} — both must be set in production ` +
      `and must match the domain you actually visit.`,
  };

  checks.jwtSecret = {
    ok: Boolean(process.env.JWT_SECRET),
    detail: process.env.JWT_SECRET ? 'JWT_SECRET is set.' : 'JWT_SECRET is not set.',
  };

  try {
    await db.$queryRaw`SELECT 1`;
    checks.database = { ok: true, detail: 'Connected to PostgreSQL.' };
  } catch (error) {
    checks.database = {
      ok: false,
      detail: error instanceof Error ? error.message : 'Connection failed.',
    };
  }

  // The most likely cause of a failed registration: the database exists but the
  // migration that creates WebAuthnChallenge was never applied.
  try {
    await db.webAuthnChallenge.count();
    checks.migrations = {
      ok: true,
      detail: 'WebAuthnChallenge table exists.',
    };
  } catch (error) {
    checks.migrations = {
      ok: false,
      detail:
        (error instanceof Error ? error.message : 'Table missing.') +
        ' — run `prisma migrate deploy` against the database.',
    };
  }

  const healthy = Object.values(checks).every((c) => c.ok);

  return NextResponse.json(
    { ok: healthy, checks },
    { status: healthy ? 200 : 503 },
  );
}