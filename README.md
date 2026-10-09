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

```bash
npm install
cp .env.example .env      # then edit JWT_SECRET
npm run setup             # prisma generate + db push
npm run dev
```

Open **http://localhost:3000**.

### Passkeys and secure contexts

Browsers only allow WebAuthn on HTTPS, with one exception: `localhost` counts
as secure. That is why `RP_ID=localhost` must stay `localhost` in development.
A passkey created on `localhost` is bound to that name and **will not** work on
a LAN IP or a tunnel domain — you must re-register there.

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
- SQLite is fine for a handful of users. Concurrent writes will serialise.

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

Set `RP_ID` and `ORIGIN` to your real domain, use a strong `JWT_SECRET`, and put
it behind TLS. Passkeys will not work over plain HTTP on a real domain.