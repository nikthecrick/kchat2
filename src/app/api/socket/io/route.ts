import { NextResponse } from 'next/server';

/**
 * This route is intentionally inert.
 *
 * WebSocket connections are handled by the custom Node server (server.ts),
 * which attaches Socket.IO directly to the HTTP server. That is the only place
 * it can live — an App Router route handler has no access to the underlying
 * HTTP server.
 *
 * The previous version of this file was a Pages Router handler
 * (NextApiRequest + `export const config = { api: ... }`) sitting inside the
 * App Router, which cannot work and broke the build.
 *
 * If a plain GET arrives here the Socket.IO layer did not claim it, so report
 * that clearly rather than pretending something is wrong with the app.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    {
      error: 'Expected a WebSocket upgrade request.',
      hint: 'Connect a Socket.IO client to /api/socket/io, or start the app with `npm run dev`.',
    },
    { status: 426 },
  );
}