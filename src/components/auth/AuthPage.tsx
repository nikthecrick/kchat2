'use client';

import { useEffect, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Shield, Lock, UserPlus, Info } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  authenticatePasskey,
  getPasskeySupport,
  type PasskeySupport,
  PasskeyCancelledError,
  registerPasskey,
} from '@/lib/webauthn-client';
import {
  exportPublicKey,
  getOrCreateLocalKeyPair,
} from '@/lib/crypto';

type Status = { kind: 'idle' | 'busy' | 'error' | 'ok'; message?: string };

export default function AuthPage() {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [username, setUsername] = useState('');
  const [support, setSupport] = useState<PasskeySupport>({ supported: true });
  const router = useRouter();

  useEffect(() => {
    setSupport(getPasskeySupport());
    fetch('/api/auth/me')
      .then((r) => {
        if (r.ok) router.replace('/chat');
      })
      .catch(() => {});
  }, [router]);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ kind: 'busy' });

    // Generate the encryption keypair here, in the browser. Only the public
    // half is sent to the server; the private half stays in localStorage, which
    // is what makes the encryption genuinely end-to-end.
    const { publicKey } = getOrCreateLocalKeyPair();

    try {
      const startRes = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          e2ePublicKey: exportPublicKey(publicKey),
        }),
      });
      const startData = await startRes.json();
      if (!startRes.ok) throw new Error(startData.error || 'Registration failed');

      const credential = await registerPasskey({ options: startData.options });

      const doneRes = await fetch('/api/auth/register/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential, challenge: startData.options.challenge }),
      });
      const doneData = await doneRes.json();
      if (!doneRes.ok) throw new Error(doneData.error || 'Could not save passkey');

      setStatus({ kind: 'ok', message: 'Passkey created. Opening your chats…' });
      router.replace('/chat');
    } catch (err) {
      if (err instanceof PasskeyCancelledError) {
        setStatus({ kind: 'idle' });
        return;
      }
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Registration failed',
      });
    }
  }

  async function handleLogin() {
    setStatus({ kind: 'busy' });
    try {
      const startRes = await fetch('/api/auth/login', { method: 'POST' });
      const startData = await startRes.json();
      if (!startRes.ok) throw new Error(startData.error || 'Login failed');

      const credential = await authenticatePasskey({ options: startData.options });

      const doneRes = await fetch('/api/auth/login/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential, challenge: startData.options.challenge }),
      });
      const doneData = await doneRes.json();
      if (!doneRes.ok) throw new Error(doneData.error || 'Login failed');

      setStatus({ kind: 'ok', message: 'Welcome back!' });
      router.replace('/chat');
    } catch (err) {
      if (err instanceof PasskeyCancelledError) {
        setStatus({ kind: 'idle' });
        return;
      }
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Login failed',
      });
    }
  }

  const busy = status.kind === 'busy';

  const hostname =
    typeof window !== 'undefined' ? window.location.hostname : '';

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
            <Shield className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold">KChat</CardTitle>
          <CardDescription>
            Your passkey is your account. No email, no password.
          </CardDescription>
        </CardHeader>

        <CardContent>
          {!support.supported && (
            <Alert className="mb-4">
              <Info className="h-4 w-4" />
              <AlertDescription>
                {support.reason}
                <span className="mt-1 block text-xs opacity-80">
                  You appear to be on{' '}
                  <code className="font-mono">{hostname}</code>. Try{' '}
                  <code className="font-mono">http://localhost:3000</code>.
                </span>
              </AlertDescription>
            </Alert>
          )}

          <Tabs defaultValue="login" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Sign in</TabsTrigger>
              <TabsTrigger value="register">Create</TabsTrigger>
            </TabsList>

            <TabsContent value="login" className="space-y-4 pt-4">
              <p className="text-sm text-muted-foreground text-center">
                Pick a passkey from your device.
              </p>
              <Button
                className="w-full"
                onClick={handleLogin}
                disabled={busy || !support.supported}
              >
                {busy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Lock className="mr-2 h-4 w-4" />
                )}
                Sign in with a passkey
              </Button>
            </TabsContent>

            <TabsContent value="register" className="space-y-4 pt-4">
              <form onSubmit={handleRegister} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="username">Username (optional)</Label>
                  <Input
                    id="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Anonymous"
                    maxLength={40}
                    disabled={busy}
                    autoComplete="off"
                  />
                  <p className="text-xs text-muted-foreground">
                    Only a display label — anyone can use the same one. Leave it
                    blank and you&apos;ll be &quot;Anonymous&quot;.
                  </p>
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={busy || !support.supported}
                >
                  {busy ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <UserPlus className="mr-2 h-4 w-4" />
                  )}
                  Create a passkey
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          {status.message && (
            <Alert
              className={`mt-4 ${
                status.kind === 'error'
                  ? 'border-destructive'
                  : 'border-green-200 bg-green-50'
              }`}
            >
              <AlertDescription
                className={
                  status.kind === 'error' ? 'text-destructive' : 'text-green-800'
                }
              >
                {status.message}
              </AlertDescription>
            </Alert>
          )}

          <div className="mt-6 text-center text-xs text-muted-foreground space-y-1">
            <p>🔑 Phishing-resistant, and there is no password to leak.</p>
            <p>🔒 Messages are encrypted in your browser, not on the server.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}