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
import {
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  Link2,
  SendHorizonal,
  Check,
  Copy,
} from 'lucide-react';
import { hashString } from '@/lib/crypto';
import {
  deriveSafetyNumberAsync,
  formatSafetyNumber,
  isCompleteSafetyNumber,
  normaliseSafetyNumber,
  safetyNumbersMatch,
} from '@/lib/safety-number';

export type VerifyStatus = 'unverified' | 'partial' | 'verified' | 'changed';

interface VerifyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  peerId: string;
  peerName: string;
  myPublicKey: string;
  peerPublicKey: string | null;
  status: VerifyStatus;
  onStatusChange: (status: VerifyStatus) => void;
  chatSessionId?: string;
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
  chatSessionId,
}: VerifyDialogProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [number, setNumber] = useState<string | null>(null);
  const [entered, setEntered] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [requestSent, setRequestSent] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const groups = number ? formatSafetyNumber(number) : [];

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
    QRCode.toDataURL(number, {
      // Request a large image and let CSS scale it down. The earlier fixed
      // 320px intrinsic size forced horizontal scrolling on phones.
      width: 640,
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
        'Those numbers do not match. Do not continue — a key may have changed, or someone may be intercepting this conversation.',
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
      const data = await res.json();
      onStatusChange(data.status ?? 'partial');
      reset();
    } catch {
      setError('Network error while saving.');
    } finally {
      setBusy(false);
    }
  }

  async function sendRequest() {
    if (!number) return;
    setBusy(true);
    setError(null);
    try {
      const hash = await hashString(number);
      const res = await fetch('/api/verify-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peerId, numberHash: hash, chatSessionId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Could not send the request.');
        return;
      }
      setRequestSent(true);
    } catch {
      setError('Network error while sending.');
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!number) return;
    setBusy(true);
    setError(null);
    try {
      const hash = await hashString(number);
      const res = await fetch('/api/verify-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peerId, numberHash: hash }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Could not create a link.');
        return;
      }
      const { token } = await res.json();
      const url = `${window.location.origin}/verify/${token}`;

      if (navigator.share) {
        // On a phone, hand it to the share sheet: they can send it over
        // whatever channel they already trust.
        try {
          await navigator.share({
            title: 'KChat safety number',
            text: `Compare this safety number with me: ${number}`,
            url,
          });
          setLinkCopied(true);
          return;
        } catch {
          // User dismissed the share sheet; fall through to copying.
        }
      }

      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2500);
    } catch {
      setError('Could not share the link.');
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
        <DialogContent className='max-h-[92dvh] overflow-y-auto'>
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
      <DialogContent className='max-h-[92dvh] overflow-y-auto gap-4 sm:max-w-md'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2 text-lg'>
            {status === 'verified' ? (
              <ShieldCheck className='h-5 w-5 shrink-0 text-green-600' />
            ) : status === 'changed' ? (
              <ShieldAlert className='h-5 w-5 shrink-0 text-amber-600' />
            ) : (
              <ShieldQuestion className='h-5 w-5 shrink-0 text-amber-600' />
            )}
            Verify {peerName}
          </DialogTitle>
          <DialogDescription className='text-sm'>
            Compare this number with the one they see. Only continue if they
            match.
          </DialogDescription>
        </DialogHeader>

        {status === 'changed' && (
          <Alert className='border-amber-500 bg-amber-50'>
            <ShieldAlert className='h-4 w-4 shrink-0' />
            <AlertDescription className='text-amber-900 text-sm'>
              Their encryption key changed since you last verified. That can
              mean a new device, but verify again before trusting this
              conversation.
            </AlertDescription>
          </Alert>
        )}

        {status === 'partial' && (
          <Alert className='border-amber-500 bg-amber-50'>
            <ShieldQuestion className='h-4 w-4 shrink-0' />
            <AlertDescription className='text-amber-900 text-sm'>
              You confirmed your side. {peerName} still needs to compare the
              number before this is fully verified.
            </AlertDescription>
          </Alert>
        )}

        {/* w-full + max-w constraints keep the QR inside the viewport on
            narrow screens instead of forcing the dialog to scroll sideways. */}
        {qrDataUrl ? (
          <div className='mx-auto w-full max-w-[240px] sm:max-w-[280px]'>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrDataUrl}
              alt={`Safety number: ${number}`}
              className='w-full h-auto rounded-lg border bg-white p-2'
            />
          </div>
        ) : (
          <div className='mx-auto aspect-square w-full max-w-[240px] rounded-lg border bg-muted animate-pulse sm:max-w-[280px]' />
        )}

        <div className='grid grid-cols-3 gap-x-2 gap-y-1.5 rounded-lg bg-muted p-3 font-mono text-center text-sm'>
          {groups.map((group, i) => (
            <span key={i} className='tracking-wider'>
              {group}
            </span>
          ))}
        </div>

        <p className='text-xs text-muted-foreground'>
          Have them scan this, read the digits aloud, or open the link you send
          them. Then type what they see below.
        </p>

        <div className='space-y-2'>
          <Label htmlFor='verify-input'>Their number</Label>
          <Input
            id='verify-input'
            value={entered}
            onChange={(e) => setEntered(e.target.value)}
            placeholder='12345 67890 …'
            inputMode='numeric'
            autoComplete='off'
            disabled={busy}
            className='font-mono'
          />
        </div>

        {error && (
          <Alert variant='destructive'>
            <AlertDescription className='text-sm'>{error}</AlertDescription>
          </Alert>
        )}

        <div className='grid gap-2 sm:grid-cols-2'>
          <Button
            variant='outline'
            onClick={copyLink}
            disabled={busy || !number || linkCopied}
          >
            {linkCopied ? (
              <Check className='mr-2 h-4 w-4' />
            ) : (
              <Link2 className='mr-2 h-4 w-4' />
            )}
            {linkCopied ? 'Copied' : 'Share link'}
          </Button>
          <Button
            variant='outline'
            onClick={sendRequest}
            disabled={busy || !number || requestSent}
          >
            <SendHorizonal className='mr-2 h-4 w-4' />
            {requestSent ? 'Requested' : 'Ask them'}
          </Button>
        </div>

        <p className='-mt-2 text-xs text-muted-foreground'>
          A shared link only displays this number. It never verifies anything
          by itself — you each confirm separately.
        </p>

        {status === 'verified' ? (
          <div className='grid gap-2 sm:grid-cols-2'>
            <Button variant='outline' onClick={revoke} disabled={busy}>
              Un-verify
            </Button>
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </div>
        ) : (
          <Button
            className='w-full'
            onClick={submit}
            disabled={busy || !isCompleteSafetyNumber(entered)}
          >
            <Check className='mr-2 h-4 w-4' />
            {status === 'partial' ? 'Confirm again' : 'I compared — mark verified'}
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}