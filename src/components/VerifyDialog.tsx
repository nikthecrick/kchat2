'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ShieldCheck, ShieldAlert, RefreshCw } from 'lucide-react';
import { hashString } from '@/lib/crypto';
import {
  deriveSafetyNumberAsync,
  formatSafetyNumber,
  isCompleteSafetyNumber,
  normaliseSafetyNumber,
  safetyNumbersMatch,
} from '@/lib/safety-number';

export type VerifyStatus = 'unverified' | 'verified' | 'changed';

interface VerifyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  peerId: string;
  peerName: string;
  myPublicKey: string;
  peerPublicKey: string | null;
  status: VerifyStatus;
  onStatusChange: (status: VerifyStatus) => void;
}

export function VerifyDialog({
  open,
  onOpenChange,
  peerId,
  peerName,
  myPublicKey,
  peerPublicKey,
  status,
  onStatusChange,
}: VerifyDialogProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [number, setNumber] = useState<string | null>(null);
  const [entered, setEntered] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const groups = number ? formatSafetyNumber(number) : [];

  // Derive in an effect: Web Crypto is async, so this cannot happen during
  // render. The number is stable for a given key pair, so one derivation is
  // enough per conversation.
  useEffect(() => {
    if (!open || !myPublicKey || !peerPublicKey) {
      setNumber(null);
      return;
    }
    let cancelled = false;
    deriveSafetyNumberAsync(myPublicKey, peerPublicKey)
      .then((value) => {
        if (!cancelled) setNumber(value);
      })
      .catch(() => {
        if (!cancelled) setNumber(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, myPublicKey, peerPublicKey]);

  useEffect(() => {
    if (!open || !number) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    // Plain digits, not a URL: any phone camera can read it without a
    // companion app, which matters because the other person may not have
    // KChat on the device they scan with.
    QRCode.toDataURL(number, {
      width: 320,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, number]);

  function reset() {
    setEntered('');
    setError(null);
  }

  async function submit() {
    if (!number) return;
    setError(null);

    if (!isCompleteSafetyNumber(entered)) {
      setError(
        `That is ${normaliseSafetyNumber(entered).length} digits. The number has 60.`,
      );
      return;
    }

    if (!safetyNumbersMatch(entered, number)) {
      setError(
        'Those numbers do not match. Do not continue — either a key changed or someone is intercepting this conversation.',
      );
      return;
    }

    setBusy(true);
    try {
      const hash = await hashString(number);
      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peerId, numberHash: hash }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Could not save the verification.');
        return;
      }
      onStatusChange('verified');
      reset();
      onOpenChange(false);
    } catch {
      setError('Network error while saving.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    try {
      await fetch(`/api/verify?peerId=${encodeURIComponent(peerId)}`, {
        method: 'DELETE',
      });
      onStatusChange('unverified');
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  if (!peerPublicKey) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Can&apos;t verify yet</DialogTitle>
            <DialogDescription>
              {peerName} has not published an encryption key, so there is no
              safety number to compare.
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {status === 'verified' ? (
              <ShieldCheck className="h-5 w-5 text-green-600" />
            ) : (
              <ShieldAlert className="h-5 w-5 text-amber-600" />
            )}
            Verify {peerName}
          </DialogTitle>
          <DialogDescription>
            Compare this number with the one they see. Only confirm if they
            match — that is what proves no one is intercepting your messages.
          </DialogDescription>
        </DialogHeader>

        {status === 'changed' && (
          <Alert className="border-amber-500 bg-amber-50">
            <ShieldAlert className="h-4 w-4" />
            <AlertDescription className="text-amber-900">
              Their encryption key changed since you last verified. That can
              mean they switched devices, but verify again before trusting this
              conversation.
            </AlertDescription>
          </Alert>
        )}

        {qrDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qrDataUrl}
            alt={`Safety number: ${number}`}
            className="mx-auto rounded-lg border bg-white p-2"
            width={288}
            height={288}
          />
        ) : (
          <div className="mx-auto h-72 w-72 rounded-lg border bg-muted animate-pulse" />
        )}

        <div className="grid grid-cols-3 gap-1.5 rounded-lg bg-muted p-3 font-mono text-center text-sm">
          {groups.map((group, i) => (
            <span key={i} className="tracking-wider">
              {group}
            </span>
          ))}
        </div>

        <p className="text-xs text-muted-foreground text-center">
          Have them scan this, read the digits aloud, or send a screenshot
          through another app — then type what they see below.
        </p>

        <div className="space-y-2">
          <Label htmlFor="verify-input">Their number</Label>
          <Input
            id="verify-input"
            value={entered}
            onChange={(e) => setEntered(e.target.value)}
            placeholder="12345 67890 …"
            inputMode="numeric"
            autoComplete="off"
            disabled={busy}
          />
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex gap-2">
          {status === 'verified' ? (
            <>
              <Button
                variant="outline"
                className="flex-1"
                onClick={revoke}
                disabled={busy}
              >
                Un-verify
              </Button>
              <Button className="flex-1" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </>
          ) : (
            <Button
              className="w-full"
              onClick={submit}
              disabled={busy || !isCompleteSafetyNumber(entered)}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${busy ? 'animate-spin' : ''}`}
              />
              {status === 'changed' ? 'Verify again' : 'Mark as verified'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}