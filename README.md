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

Notes:

- `npm run db:push` is for throwaway databases only. Once there is real
  data, use `npm run db:migrate` (dev) and `npm run db:deploy` (production).

- If you created the schema earlier with `db push` rather than a migration,
  Prisma will refuse to apply migrations to it (P3005). Baseline it once with
  `npx prisma migrate resolve --applied 20260101000000_init`, which records
  the existing schema as already applied without touching the data. See
  "Deploying to Render" below.

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
- **The server could substitute public keys**, which would defeat the
  encryption silently. Safety numbers (see below) let two users detect this by
  comparing a value the server cannot forge.

## Architecture

```
server.ts              custom Node server: Next + Socket.IO on one HTTP server
prisma/schema.prisma   User, WebAuthnChallenge, ChatSession, Message, VerifiedKeyPair
src/lib/webauthn.ts    server-side ceremony + challenge storage
src/lib/webauthn-client.ts   browser ceremony
src/lib/crypto.ts      X25519 + secretbox (browser only)
src/lib/safety-number.ts     client-side safety-number derivation
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
| GET    | `/api/verify?peerId=`       | Verification status, key-change flag  |
| POST   | `/api/verify`               | Mark a pair verified                 |
| DELETE | `/api/verify?peerId=`       | Revoke a verification                |
| GET    | `/api/verify-request`       | List verification requests           |
| POST   | `/api/verify-request`       | Ask someone to verify                |
| PUT    | `/api/verify-request`       | Mark a request seen / completed      |
| DELETE | `/api/verify-request?id=`   | Cancel a request you sent            |
| GET    | `/api/health`               | Deployment diagnostics               |

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

That command must not be the **build** command — Render builds first, and
migrations belong at startup, not at build time. If Render reports "Running
build command 'prisma migrate deploy && npm start'", move that string into
Settings → Start Command and restore the build command to
`npm install; npm run build`.

**If you previously used `db push` to create the schema** (which is what this
project's early setup did), the database is not empty but has no migration
history, so `migrate deploy` stops with P3005. Baseline it once:

```bash
DATABASE_URL="<your postgres url>" npx prisma migrate resolve --applied 20260101000000_init
```

This marks the existing schema as already applied and records it in
`_prisma_migrations` without dropping or recreating anything. After that,
`migrate deploy` works normally. Only run it against the database whose
schema matches that migration — never to paper over a genuine mismatch.

Two things that bite on Render specifically:

- **Set `RP_ID` and `ORIGIN` to the real domain.** Passkeys are bound to it, so
  accounts created on `localhost` will not work in production. Users register
  fresh there.
- **Free instances sleep after ~15 minutes idle.** WebSockets drop and the
  first request after waking takes ~30 seconds. Use a paid instance if chat
  needs to feel reliable.

## Key verification (safety numbers)

Without this, the encryption has a real hole: the server holds both users'
public keys, so a malicious or compromised server could substitute its own key
in place of one user's, decrypt the traffic, and re-encrypt it for the other
party. Neither side would notice anything wrong.

Safety numbers close that gap. Both sides derive the same number **in the
browser**, from the sorted pair of public keys:

```
sorted(pubA, pubB) -> SHA-256("kchat-safety-v1|…") -> 60 digits
```

Sorting makes the result identical from either end of the conversation, so
Alice and Bob see the same number. A human then compares them through a channel
the server cannot observe. If a key was substituted, the numbers differ and the
mismatch becomes visible.

**How to verify:** open a conversation, click the shield in the header, and
compare the QR code or the 60 digits (12 groups of 5) against what the other
person sees. Scanning the QR with a phone camera is quickest — it displays the
digits, which are then compared by eye. Alternatively, type the digits they read
to you into the validation box. The number never leaves the browser.

**Asking someone to verify:** the same dialog has an "Ask {name} to verify"
button. It drops a request into their inbox — visible in the sidebar and pushed
live over the socket — carrying the hash of the safety number. They can jump
straight to the comparison instead of hunting for you first.

A request is a workflow convenience, **not** a security mechanism. Completion
stays manual on both sides: a completed request marks nobody verified on its
own. The security property still comes entirely from two humans comparing
digits through a channel the server cannot observe. A request can help two
people reach that comparison; it cannot stand in for it.

Verified state is stored server-side so it follows the account across devices.
The server learns only *that* a pair was verified plus a hash of the number,
which is of no use to it since it already holds both public keys.

**Re-verification is automatic.** The hash is recomputed whenever a conversation
is opened. If a peer's public key changes, the header switches to `Key changed`
and asks for verification again — catching a substitution made *after* an
initial verification.

**The limit of this scheme:** it is trust-on-first-verify. If keys are
substituted before anyone ever compares numbers, those substituted numbers get
confirmed. Signal has the same property; it is inherent to the approach rather
than a flaw in this implementation.