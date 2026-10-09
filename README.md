# KChat

Passkey-only chat. No email, no password. You pick an optional display name,
create a passkey, and you are in.

## Why this works without a username

Login sends a WebAuthn request with an **empty `allowCredentials` list**. This is
a *discoverable credential* request: instead of the server telling the browser
which keys to look for, the browser shows its own native passkey picker and tells
the server which credential was used. The user is then looked up by the
credential ID inside the signed assertion.

That is what makes the passkey the identity rather than a second factor bolted
onto an email address. The username is purely cosmetic and is explicitly
**not unique** — several people may all be "Anonymous". If you don't choose one,
that is what you are called.

## Setup

You need a PostgreSQL database. Locally, any of these work:

```bash
# Option A: a local Postgres
createdb kchat
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/kchat?schema=public"

# Option B: no local install — a throwaway free Postgres
npx prisma init --datasource-provider postgresql
```

Then:

```bash
npm install
cp .env.example .env      # then edit DATABASE_URL and JWT_SECRET
npm run setup             # prisma generate + prisma migrate dev (creates migration)
npm run dev
```

Open **http://localhost:3000**.

Note: `npm run db:push` is for throwaway databases only. Once there is real
data, use `npm run db:migrate` (dev) and `npm run db:deploy` (production).

To generate a real secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## What is actually encrypted, and what is not

Honest summary, because the previous version of this README described a Double
Ratchet that the code did not implement.

**Real:**
- Every message is encrypted in the browser with X25519 + XSalsa20-Poly1305
  (`tweetnacl`) under a key derived from the two users' public keys.
- Private keys are generated in the browser and kept in `localStorage`. They are
  never transmitted. The server stores only public keys.
- Therefore **the server cannot read any message**. This is genuine
  end-to-end encryption.

**Not implemented:**
- **Forward secrecy.** A leaked long-term private key decrypts all history.
  Real forward secrecy needs a proper Double Ratchet with per-device keys and
  prekey delivery. That is a substantially larger project than this one.

The earlier code claimed a Double Ratchet while storing the private keys and the
ratchet state on the server, which meant the server held everything it was
supposed to be blind to. All of that has been removed.

### Other things worth knowing

- **Single device per account.** A passkey lives on one device. Clearing
  browser data or switching devices means the account is unrecoverable — there
  is no reset flow, because there is no email to reset with. This is inherent
  to the design; adding recovery means adding some trusted second factor.
- Because usernames are not unique, two anonymous users appear identically in
  the browser's passkey picker.
- **The server can substitute public keys**, so this is not yet hardened
  against an actively malicious server. Safety-number verification is the fix
  and is not implemented yet. See "Adding key verification" below.

## Architecture

```
server.ts              custom Node server: Next + Socket.IO on one HTTP server
prisma/schema.prisma   User, WebAuthnChallenge, ChatSession, Message
src/lib/webauthn.ts    server-side ceremony + challenge storage
src/lib/webauthn-client.ts   browser ceremony
src/lib/crypto.ts      X25519 + secretbox (browser only)
src/lib/auth.ts        JWT session cookie (httpOnly)
```

Socket.IO lives in `server.ts` rather than a route handler because the App
Router has no access to the underlying HTTP server that WebSockets need.

The session cookie is `httpOnly`, so the socket client cannot read it in JS. The
server reads it from the handshake headers instead. (The previous client used
`document.cookie.split('session-token=')[1]`, which is always `undefined`.)

## API

| Method | Path                        | Purpose                              |
| ------ | --------------------------- | ------------------------------------ |
| POST   | `/api/auth/register`        | Begin registration (username optional) |
| POST   | `/api/auth/register/complete` | Save passkey, start session         |
| POST   | `/api/auth/login`           | Begin passkey login (no username)    |
| POST   | `/api/auth/login/complete`  | Verify assertion, start session      |
| GET    | `/api/auth/me`              | Current user                         |
| GET    | `/api/users?q=`             | Find people                          |
| GET    | `/api/chat/session`         | List conversations                   |
| POST   | `/api/chat/session`         | Start a conversation                 |
| GET    | `/api/chat/messages`        | Ciphertext history                   |
| POST   | `/api/chat/messages`        | Store a message                      |

Challenges are stored server-side in `WebAuthnChallenge` and deleted on use, so
the client cannot choose the value it is later verified against.

## Deployment

Set these environment variables:

| Variable       | Value                                      |
| -------------- | ------------------------------------------ |
| `DATABASE_URL` | Postgres URL (use Render's *Internal* URL) |
| `RP_ID`        | your exact domain, e.g. `kchat2.onrender.com` |
| `ORIGIN`       | `https://yourdomain`                       |
| `JWT_SECRET`   | a long random string                      |

Use a start command that applies migrations before booting:

```
prisma migrate deploy && npm start
```

Two things that bite on Render specifically:

- **Set `RP_ID` and `ORIGIN` to the real domain.** Passkeys are bound to it, so
  accounts created on `localhost` will not work in production. Users register
  fresh there.
- **Free instances sleep after ~15 minutes idle.** WebSockets drop and the
  first request after waking takes ~30 seconds. Use a paid instance if chat
  needs to feel reliable.

## Adding key verification (not implemented yet)

The current design defends against a server that reads data it is given. It
does not defend against a server that *substitutes* a public key and reads the
traffic it then decrypts.

The fix is a safety number both sides compute **in the browser**, from the
sorted pair of public keys:

```
sorted(pubA, pubB) -> SHA-256 -> digits, grouped for reading
```

Since it is derived client-side, the server cannot forge it. Users compare it
through a channel the server does not control — read aloud, scanned as a QR
code, or sent over another app. A conversation stays flagged "unverified" until
that comparison is done, and re-flags if the peer's public key ever changes.