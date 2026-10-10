'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Send,
  Search,
  MessageSquare,
  LogOut,
  Moon,
  Sun,
  Lock,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  ChevronLeft,
} from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { LoadingPage } from '@/components/Loading';
import ErrorBoundary from '@/components/ErrorBoundary';
import {
  decryptFrom,
  encryptFor,
  exportPublicKey,
  getOrCreateLocalKeyPair,
  hashString,
} from '@/lib/crypto';
import { VerifyDialog, type VerifyStatus } from '@/components/VerifyDialog';
import { VerifyRequestsInbox } from '@/components/VerifyRequestsInbox';
import { deriveSafetyNumberAsync } from '@/lib/safety-number';

interface Peer {
  id: string;
  username: string | null;
  displayName: string;
  publicKey: string | null;
}

interface Session {
  id: string;
  peer: Peer;
  lastMessageAt: string | null;
}

interface Me {
  id: string;
  username: string | null;
  displayName: string;
  e2ePublicKey: string | null;
}

interface MessageRow {
  id: string;
  senderId: string;
  ciphertext: string;
  timestamp: string;
}

interface DecryptedMessage {
  id: string;
  senderId: string;
  text: string;
  timestamp: string;
}

export default function ChatPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [active, setActive] = useState<Session | null>(null);
  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Peer[]>([]);
  const [peerTyping, setPeerTyping] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>('unverified');
  const [verifyToken, setVerifyToken] = useState(0);
  const publicKeyRef = useRef<string | null>(null);
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const socketRef = useRef<Socket | null>(null);
  const privateKeyRef = useRef<Uint8Array | null>(null);
  // Mirrors `active` so socket handlers — which are registered once and must
  // not resubscribe on every selection — can read the current value.
  const activeRef = useRef<Session | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) {
          router.replace('/');
          return;
        }
        const user: Me = await res.json();
        const pair = getOrCreateLocalKeyPair();
        privateKeyRef.current = pair.privateKey;
        publicKeyRef.current = exportPublicKey(pair.publicKey);
        setMe(user);
      } catch {
        router.replace('/');
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/chat/session');
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions ?? []);
      }
    } catch {
      /* transient */
    }
  }, []);

  /** Look up whether this conversation has been verified for the active peer. */
  const refreshVerification = useCallback(async (session: Session) => {
    const mine = publicKeyRef.current;
    if (!mine || !session.peer.publicKey) {
      setVerifyStatus('unverified');
      return;
    }
    try {
      const number = await deriveSafetyNumberAsync(mine, session.peer.publicKey);
      const hash = await hashString(number);
      const res = await fetch(
        `/api/verify?peerId=${encodeURIComponent(session.peer.id)}&numberHash=${hash}`,
      );
      if (!res.ok) {
        setVerifyStatus('unverified');
        return;
      }
      const data = await res.json();
      setVerifyStatus(
        data.status === 'verified' ||
          data.status === 'partial' ||
          data.status === 'changed'
          ? data.status
          : 'unverified',
      );
    } catch {
      setVerifyStatus('unverified');
    }
  }, []);

  /** Select a conversation, join its room, and decrypt its history. */
  const openSessionWith = useCallback(async (session: Session) => {
    activeRef.current = session;
    setActive(session);
    setError(null);
    socketRef.current?.emit('join-chat', session.id);
    void refreshVerification(session);

    const priv = privateKeyRef.current;
    const peerPub = session.peer.publicKey;
    if (!priv || !peerPub) {
      setError(
        "This conversation can't be decrypted: the other person's public key is missing.",
      );
      setMessages([]);
      return;
    }

    const res = await fetch(`/api/chat/messages?chatSessionId=${session.id}`);
    if (!res.ok) {
      setError('Could not load messages.');
      return;
    }
    const { messages: rows } = await res.json();

    setMessages(
      (rows as MessageRow[]).map((row) => {
        try {
          return {
            id: row.id,
            senderId: row.senderId,
            text: decryptFrom(row.ciphertext, priv, base64ToBytes(peerPub)),
            timestamp: row.timestamp,
          };
        } catch {
          return {
            id: row.id,
            senderId: row.senderId,
            text: '⚠️ Could not decrypt this message',
            timestamp: row.timestamp,
          };
        }
      }),
    );
  }, [refreshVerification]);

  useEffect(() => {
    if (!me) return;
    loadSessions();

    // No token is passed: the session cookie is httpOnly, so the server reads
    // it from the handshake headers. The previous client tried to read it via
    // document.cookie, which always returned undefined and broke auth.
    const socket = io({ path: '/api/socket/io' });
    socketRef.current = socket;

    socket.on('message-received', ({ chatSessionId }: { chatSessionId: string }) => {
      const current = activeRef.current;
      if (current?.id === chatSessionId) void openSessionWith(current);
      else void loadSessions();
    });

    socket.on('user-typing', ({ userId, isTyping }: { userId: string; isTyping: boolean }) => {
      const current = activeRef.current;
      if (current && userId === current.peer.id) setPeerTyping(isTyping);
    });

    // Poll for verification requests on connect. A dedicated event keeps this
    // simple: the inbox itself fetches on mount, and this catches anything
    // created while the user is already open.
    socket.emit('verify-request:check');
    socket.on('verify-request:check', () => socket.emit('verify-request:check'));

    socket.on('verify-request:incoming', (data: { count: number }) => {
      // Bump the token so the inbox refetches.
      if (data?.count > 0) setVerifyToken((t) => t + 1);
    });

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [me, loadSessions, openSessionWith]);

  useEffect(() => {
    if (query.trim().length === 0) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/users?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        setResults(data.users ?? []);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  async function startChat(peer: Peer) {
    const res = await fetch('/api/chat/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId: peer.id }),
    });
    if (!res.ok) return;
    const data = await res.json();
    setQuery('');
    setResults([]);
    await loadSessions();
    await openSessionWith(data.session);
  }

  async function send() {
    const text = draft.trim();
    if (!text || !active || !me) return;

    const priv = privateKeyRef.current;
    if (!priv || !active.peer.publicKey) return;

    setDraft('');
    const ciphertext = encryptFor(text, priv, base64ToBytes(active.peer.publicKey));

    const res = await fetch('/api/chat/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatSessionId: active.id, ciphertext }),
    });
    if (!res.ok) {
      setError('Message failed to send.');
      setDraft(text);
      return;
    }
    const { message } = await res.json();
    setMessages((prev) => [
      ...prev,
      { id: message.id, senderId: me.id, text, timestamp: message.timestamp },
    ]);
    socketRef.current?.emit('message-sent', {
      chatSessionId: active.id,
      messageId: message.id,
      receiverId: active.peer.id,
    });
    void loadSessions();
  }

  if (loading || !me) return <LoadingPage text="Opening your chats…" />;

  return (
    <ErrorBoundary>
      <div className='flex h-dvh overflow-hidden bg-background'>
        {/* Sidebar: full width on mobile, fixed column from sm up. Hidden on
            mobile once a conversation is open, otherwise it sits beside the
            message list and squeezes both. */}
        <div
          className={`${
            active ? 'hidden sm:flex' : 'flex'
          } w-full sm:w-80 sm:shrink-0 border-r flex-col h-full`}
        >
          <VerifyRequestsInbox
            refreshToken={verifyToken}
            onOpenVerify={(peerId) => {
              const session = sessions.find((s) => s.peer.id === peerId);
              if (session) {
                activeRef.current = session;
                setActive(session);
                setVerifyOpen(true);
              }
            }}
          />
          <div className="p-4 border-b">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h1 className="text-xl font-bold">KChat</h1>
                <p className="text-xs text-muted-foreground">{me.displayName}</p>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                >
                  {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => router.replace('/')}
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Find someone…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            {results.length > 0 && (
              <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                {results.map((user) => (
                  <button
                    key={user.id}
                    onClick={() => startChat(user)}
                    className="w-full text-left p-2 hover:bg-accent rounded flex items-center gap-2"
                  >
                    <Avatar className="h-8 w-8">
                      <AvatarFallback>{user.displayName[0]?.toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <span className="text-sm font-medium truncate">
                      {user.displayName}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <ScrollArea className="flex-1">
            <div className="p-2">
              <h2 className="text-xs font-semibold text-muted-foreground mb-2 px-2">
                Conversations
              </h2>
              {sessions.length === 0 && (
                <p className="p-3 text-sm text-muted-foreground">
                  No conversations yet. Search for someone above to start one.
                </p>
              )}
              {sessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => void openSessionWith(session)}
                  className={`w-full text-left p-3 rounded-lg flex items-center gap-3 ${
                    active?.id === session.id ? 'bg-accent' : 'hover:bg-accent/50'
                  }`}
                >
                  <Avatar className="h-9 w-9">
                    <AvatarFallback>
                      {session.peer.displayName[0]?.toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">
                      {session.peer.displayName}
                    </div>
                    {session.lastMessageAt && (
                      <div className="text-xs text-muted-foreground">
                        {new Date(session.lastMessageAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>

        {active ? (
          <div className="flex-1 flex flex-col min-w-0">
            <div className="p-3 sm:p-4 border-b flex items-center gap-2 sm:gap-3">
              {/* Back button, mobile only: the sidebar is hidden once a
                  conversation is open, so this is the only way out. */}
              <Button
                variant="ghost"
                size="icon"
                className="sm:hidden shrink-0 -ml-1"
                onClick={() => {
                  activeRef.current = null;
                  setActive(null);
                  setMessages([]);
                }}
              >
                <ChevronLeft className="h-5 w-5" />
                <span className="sr-only">Back to conversations</span>
              </Button>
              <Avatar className="shrink-0">
                <AvatarFallback>
                  {active.peer.displayName[0]?.toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">
                  {active.peer.displayName}
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                  {peerTyping ? (
                    'Typing…'
                  ) : (
                    <>
                      <Lock className="h-3 w-3 shrink-0" />
                      End-to-end encrypted
                    </>
                  )}
                </div>
              </div>
              <button
                onClick={() => setVerifyOpen(true)}
                className="shrink-0 flex items-center gap-1.5 rounded-full border px-2.5 sm:px-3 py-1 text-xs font-medium transition-colors hover:bg-accent"
              >
                {verifyStatus === 'verified' ? (
                  <>
                    <ShieldCheck className="h-3.5 w-3.5 text-green-600" />
                    <span className="hidden sm:inline text-green-700">Verified</span>
                  </>
                ) : verifyStatus === 'partial' ? (
                  <>
                    <ShieldQuestion className="h-3.5 w-3.5 text-amber-600" />
                    <span className="hidden sm:inline text-amber-700">Half</span>
                  </>
                ) : verifyStatus === 'changed' ? (
                  <>
                    <ShieldAlert className="h-3.5 w-3.5 text-amber-600" />
                    <span className="hidden sm:inline text-amber-700">Key changed</span>
                  </>
                ) : (
                  <>
                    <ShieldAlert className="h-3.5 w-3.5 text-amber-600" />
                    <span className="hidden sm:inline text-amber-700">Not verified</span>
                  </>
                )}
              </button>
            </div>

            <ScrollArea className="flex-1 p-4">
              <div className="space-y-3">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.senderId === me.id ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-md px-4 py-2 rounded-lg text-sm ${
                        message.senderId === me.id
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted'
                      }`}
                    >
                      <div className="break-words">{message.text}</div>
                      <div className="text-[10px] opacity-70 mt-1">
                        {new Date(message.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>

            <div className="p-3 sm:p-4 border-t pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {error && (
                <p className="mb-2 text-sm text-destructive">{error}</p>
              )}
              <div className="flex gap-2">
                <Input
                  placeholder="Write a message…"
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    socketRef.current?.emit('typing', {
                      chatSessionId: active.id,
                      isTyping: e.target.value.length > 0,
                    });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                <Button onClick={() => void send()} disabled={!draft.trim()} className="shrink-0">
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <h3 className="text-lg font-semibold mb-2">Pick a conversation</h3>
              <p>Search for someone to get started.</p>
            </div>
          </div>
        )}
      </div>

      {active && (
        <VerifyDialog
          open={verifyOpen}
          onOpenChange={setVerifyOpen}
          peerId={active.peer.id}
          peerName={active.peer.displayName}
          myPublicKey={publicKeyRef.current ?? ''}
          peerPublicKey={active.peer.publicKey}
          status={verifyStatus}
          onStatusChange={(next) => {
            setVerifyStatus(next);
            // Refresh the inbox so a completed request stops showing.
            setVerifyToken((t) => t + 1);
          }}
          chatSessionId={active.id}
        />
      )}
    </ErrorBoundary>
  );
}

/** Server public keys are stored as standard base64. */
function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}