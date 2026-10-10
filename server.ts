/**
 * KChat custom server.
 *
 * Socket.IO has to be attached to the underlying Node HTTP server, which is not
 * reachable from an App Router route handler. The previous attempt put a
 * Pages-Router handler (`NextApiRequest` / `export const config = { api: ... }`)
 * inside src/app/api/socket/io/route.ts, which cannot work in the App Router.
 *
 * Run with: npm run dev  (tsx server.ts)
 */
import { createServer } from 'http';
import next from 'next';
import { loadEnvConfig } from '@next/env';
import { Server as SocketIOServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

// Assigned after loadEnvConfig() below — constructing PrismaClient at module
// scope would happen before .env is read, leaving DATABASE_URL undefined.
let prisma: PrismaClient;

/**
 * Load .env before anything reads process.env.
 *
 * Next only loads env files as part of `next()` / app.prepare(). A custom
 * server runs top-level code before that happens, so without this explicit
 * load a perfectly good local .env would be invisible and the server would
 * exit even though nothing was actually misconfigured. Real environment
 * variables (Render, Docker) take precedence and are never overwritten.
 */
loadEnvConfig(process.cwd());

// Route handlers share this process, so a single client is enough.
prisma = new PrismaClient();

const dev = process.env.NODE_ENV !== 'production';
// Always bind 0.0.0.0. Render sets HOSTNAME to the service name, so trusting
// it would make the server bind to a hostname that isn't resolvable locally.
const hostname = '0.0.0.0';
const port = Number(process.env.PORT || 3000);

const SESSION_COOKIE = 'kchat-session';

/**
 * Fail fast on missing configuration.
 *
 * Without this, a missing DATABASE_URL doesn't surface until the first request
 * that touches Prisma, which reads as an unrelated 500 several minutes after
 * deploy.
 */
function assertConfiguration(): void {
  const missing: string[] = [];

  if (!process.env.DATABASE_URL) {
    missing.push('DATABASE_URL (PostgreSQL connection string)');
  }
  if (!process.env.JWT_SECRET) {
    missing.push('JWT_SECRET');
  }
  if (!process.env.ORIGIN) {
    missing.push('ORIGIN (e.g. https://your-app.onrender.com)');
  }
  if (!process.env.RP_ID) {
    missing.push('RP_ID (your domain, without https://)');
  }

  if (missing.length > 0) {
    console.error('\n  ✗ Cannot start: missing environment variables\n');
    for (const name of missing) console.error(`      - ${name}`);
    console.error(
      '\n  Set these in your host provider. RP_ID must be your domain exactly,\n' +
        '  with no scheme or path — passkeys will not work otherwise.\n',
    );
    process.exit(1);
  }
}

assertConfiguration();

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const SOCKET_PATH = '/api/socket/io';

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    // Socket.IO registers its own 'request' listener on this same server.
    // If we also let Next handle the socket path, both would try to write a
    // response and the connection would break, so we stand down here.
    if (req.url && req.url.startsWith(SOCKET_PATH)) return;
    void handle(req, res);
  });

  const io = new SocketIOServer(httpServer, {
    path: SOCKET_PATH,
    addTrailingSlash: false,
  });

  io.use((socket, nextFn) => {
    // The session cookie is httpOnly, so the browser cannot read it in JS.
    // The old client did `document.cookie.split('session-token=')[1]`, which is
    // always undefined — meaning socket auth could never have succeeded. Read
    // the cookie from the handshake headers instead.
    const token =
      readCookie(socket.handshake.headers.cookie, SESSION_COOKIE) ||
      (socket.handshake.auth?.token as string | undefined);

    if (!token) return nextFn(new Error('unauthorized'));

    try {
      const secret =
        process.env.JWT_SECRET || 'insecure-development-only-secret';
      const payload = jwt.verify(token, secret) as { userId?: string };
      if (!payload?.userId) return nextFn(new Error('unauthorized'));
      socket.data.userId = payload.userId;
      nextFn();
    } catch {
      nextFn(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const userId: string = socket.data.userId;
    socket.join(`user:${userId}`);
    socket.data.joined = new Set<string>();

    socket.on('join-chat', (chatSessionId: string) => {
      if (typeof chatSessionId !== 'string') return;
      socket.join(`chat:${chatSessionId}`);
      socket.data.joined.add(chatSessionId);
    });

    socket.on('leave-chat', (chatSessionId: string) => {
      socket.leave(`chat:${chatSessionId}`);
      socket.data.joined.delete(chatSessionId);
    });

    socket.on('typing', (data: { chatSessionId: string; isTyping: boolean }) => {
      if (!data?.chatSessionId) return;
      socket.to(`chat:${data.chatSessionId}`).emit('user-typing', {
        userId,
        isTyping: Boolean(data.isTyping),
      });
    });

    // Only a notification. The ciphertext itself travels over the REST API so
    // there is exactly one source of truth for message ordering and storage.
    socket.on(
      'message-sent',
      (data: { chatSessionId: string; messageId: string; receiverId?: string }) => {
        if (!data?.chatSessionId) return;
        if (data.receiverId) {
          socket.to(`user:${data.receiverId}`).emit('message-received', {
            chatSessionId: data.chatSessionId,
            messageId: data.messageId,
          });
        }
        socket.to(`chat:${data.chatSessionId}`).emit('message-received', {
          chatSessionId: data.chatSessionId,
          messageId: data.messageId,
        });
      },
    );

    socket.on('disconnect', () => {
      socket.leave(`user:${userId}`);
    });

    // Deliver any pending verification requests to a user who is already
    // connected. The client emits this on connect and can re-emit to poll.
    socket.on('verify-request:check', async () => {
      try {
        const pending = await prisma.verificationRequest.findMany({
          where: { toUserId: userId, status: { not: 'completed' } },
          orderBy: { createdAt: 'desc' },
          take: 20,
        });
        socket.emit('verify-request:incoming', {
          count: pending.length,
          requests: pending.map((r) => ({
            id: r.id,
            peerId: r.fromUserId,
            status: r.status,
            createdAt: r.createdAt,
          })),
        });
      } catch (error) {
        console.error('verify-request:check failed', error);
      }
    });
  });

  httpServer
    .once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(
          `\n  Port ${port} is already in use.\n` +
            `  Another copy of the server is probably still running:\n` +
            `    lsof -ti tcp:${port} | xargs kill\n`,
        );
        process.exit(1);
      }
      throw err;
    })
    .listen(port, hostname, () => {
      // Print localhost, not the bind address. WebAuthn requires a secure
      // context and only treats "localhost" (or https) as one — browsing to
      // http://0.0.0.0:3000 or a LAN IP silently disables passkeys.
      console.log(`\n  KChat ready on http://localhost:${port}`);
      console.log(
        `  Passkeys need a secure context. Open exactly that localhost URL —\n` +
          `  http://192.168.x.x:${port} and http://0.0.0.0:${port} will NOT work.\n`,
      );
    });
});