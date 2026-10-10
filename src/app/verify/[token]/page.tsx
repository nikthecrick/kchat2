'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, ShieldCheck, Info } from 'lucide-react';
import { deriveSafetyNumberAsync, formatSafetyNumber } from '@/lib/safety-number';

interface LinkData {
  fromUser: { id: string; name: string; publicKey: string };
  toUser: { id: string; name: string; publicKey: string };
  expiresAt: string;
}

/**
 * Public page for a shared verification link.
 *
 * This page only DISPLAYS a safety number. It does not verify anything, and it
 * does not require being signed in.
 *
 * That is deliberate. If opening a link marked a conversation verified, then
 * whoever issued the link could open it too — including the server, which is
 * the attack safety numbers are meant to stop. The number is only ever shown so
 * a human can compare it against the number they were shown elsewhere.
 */
export default function VerifyLinkPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const [data, setData] = useState<LinkData | null>(null);
  const [number, setNumber] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { token } = await params;
        const res = await fetch(`/api/verify-link/${encodeURIComponent(token)}`);
        const json = await res.json();

        if (!res.ok) {
          if (!cancelled) setError(json.error || 'Could not open this link.');
          return;
        }
        if (cancelled) return;

        setData(json);
        const derived = await deriveSafetyNumberAsync(
          json.fromUser.publicKey,
          json.toUser.publicKey,
        );
        if (!cancelled) setNumber(derived);
      } catch {
        if (!cancelled) setError('Network error.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [params]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto w-14 h-14 bg-primary/10 rounded-full flex items-center justify-center mb-3">
            <ShieldCheck className="h-7 w-7 text-primary" />
          </div>
          <CardTitle className="text-xl">Safety number</CardTitle>
          <CardDescription>
            {data
              ? `${data.fromUser.name} and ${data.toUser.name}`
              : 'Loading…'}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {loading && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {number && !loading && (
            <>
              <div className="grid grid-cols-3 gap-1.5 rounded-lg bg-muted p-4 font-mono text-center text-base">
                {formatSafetyNumber(number).map((group, i) => (
                  <span key={i} className="tracking-wider">
                    {group}
                  </span>
                ))}
              </div>

              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  Check this matches the number shown in the app. If it does,
                  nobody is intercepting this conversation. This page does not
                  mark anything as verified — you each confirm in the app.
                </AlertDescription>
              </Alert>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}