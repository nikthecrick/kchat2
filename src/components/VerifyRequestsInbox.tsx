'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ShieldAlert, X, Bell } from 'lucide-react';

export interface VerifyRequestItem {
  id: string;
  peerId: string;
  peerName: string;
  direction: 'sent' | 'received';
  status: 'pending' | 'seen' | 'completed';
  numberHash: string;
  createdAt: string;
}

interface VerifyRequestsInboxProps {
  /** Open the verification dialog for a given peer. */
  onOpenVerify: (peerId: string, peerName: string, numberHash: string) => void;
  refreshToken?: number;
}

/**
 * Inbox for verification requests.
 *
 * Important framing: a completed request does NOT mean anyone is verified. It
 * only means both people have been walked through the comparison. Each side
 * still has to run its own check, which is recorded separately via
 * POST /api/verify.
 */
export function VerifyRequestsInbox({
  onOpenVerify,
  refreshToken,
}: VerifyRequestsInboxProps) {
  const [requests, setRequests] = useState<VerifyRequestItem[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/verify-request');
      if (!res.ok) return;
      const data = await res.json();
      setRequests(data.requests ?? []);
    } catch {
      /* transient */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const incoming = requests.filter(
    (r) =>
      r.direction === 'received' &&
      r.status !== 'completed' &&
      !dismissed.has(r.id),
  );

  const outgoing = requests.filter(
    (r) => r.direction === 'sent' && r.status !== 'completed',
  );

  async function complete(id: string) {
    await fetch('/api/verify-request', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status: 'completed' }),
    });
    setDismissed((prev) => new Set(prev).add(id));
    void load();
  }

  if (incoming.length === 0 && outgoing.length === 0) return null;

  return (
    <div className="p-3 border-b space-y-2">
      {incoming.map((request) => (
        <Alert key={request.id} className="border-amber-500 bg-amber-50">
          <ShieldAlert className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-900 text-xs space-y-2">
            <p>
              <strong>{request.peerName}</strong> asked you to verify your
              conversation. Open their chat to compare the safety numbers.
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() =>
                  onOpenVerify(
                    request.peerId,
                    request.peerName,
                    request.numberHash,
                  )
                }
              >
                <Bell className="mr-1 h-3 w-3" />
                Review
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => complete(request.id)}
              >
                <X className="mr-1 h-3 w-3" />
                Dismiss
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ))}

      {outgoing.map((request) => (
        <Alert key={request.id} className="py-2 bg-muted/50">
          <AlertDescription className="text-xs flex items-center gap-2">
            <span className="flex-1">
              Waiting for <strong>{request.peerName}</strong> to compare your
              safety number
              {request.status === 'seen' && ' — they have seen it'}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs"
              onClick={async () => {
                await fetch(`/api/verify-request?id=${request.id}`, {
                  method: 'DELETE',
                });
                void load();
              }}
            >
              Cancel
            </Button>
          </AlertDescription>
        </Alert>
      ))}
    </div>
  );
}