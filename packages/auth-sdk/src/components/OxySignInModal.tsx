/**
 * OxySignInModal — the minimal, dependency-free in-app "Sign in with Oxy" UI.
 *
 * Rendered by {@link WebOxyProvider} out-of-the-box (opened by `signIn()`), and
 * exported so a consumer can render it directly. It is deliberately minimal —
 * inline styles only, no CSS framework, no `react-dom` portal dependency (a
 * fixed-position overlay covers the viewport regardless of DOM nesting) — so any
 * consumer that wants a branded experience can ignore it and build their own UI
 * over the headless {@link useOxySignIn} + {@link useCommonsSignIn} hooks.
 *
 * Two input methods, both of which also serve the "add another account" case
 * (the provider commit path registers + activates the account either way):
 *   - Password (with a 2FA step when the account requires it).
 *   - QR code — the cross-device "Sign in with Oxy" handoff (scan with Commons).
 *
 * The content is mounted only while `open` is true, so every open starts from a
 * fresh hook state (no stale `authorized`/`error` from a prior open).
 */

import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { useOxySignIn } from '../hooks/useOxySignIn';
import { useCommonsSignIn } from '../hooks/useCommonsSignIn';

export interface OxySignInModalProps {
  open: boolean;
  onClose: () => void;
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 2147483000,
  padding: 16,
};

const backdropStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  border: 'none',
  padding: 0,
  margin: 0,
  background: 'rgba(0, 0, 0, 0.5)',
  cursor: 'default',
};

const cardStyle: CSSProperties = {
  position: 'relative',
  zIndex: 1,
  // Override the UA <dialog> default `margin: auto`, which would fight the flex
  // overlay's centering and offset the card.
  margin: 0,
  width: '100%',
  maxWidth: 380,
  background: '#ffffff',
  color: '#111111',
  border: 'none',
  borderRadius: 16,
  padding: 24,
  boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  boxSizing: 'border-box',
};

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid #d0d0d0',
  fontSize: 15,
  boxSizing: 'border-box',
  marginTop: 8,
};

const primaryButtonStyle: CSSProperties = {
  width: '100%',
  padding: '11px 12px',
  borderRadius: 10,
  border: 'none',
  background: '#111111',
  color: '#ffffff',
  fontSize: 15,
  fontWeight: 600,
  cursor: 'pointer',
  marginTop: 16,
};

const linkButtonStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#4b5563',
  fontSize: 14,
  cursor: 'pointer',
  padding: 0,
  marginTop: 16,
};

const errorStyle: CSSProperties = {
  color: '#b91c1c',
  fontSize: 13,
  marginTop: 12,
};

function PasswordForm({ onClose }: { onClose: () => void }) {
  const { phase, error, isSubmitting, submitPassword, submitTwoFactor, reset } = useOxySignIn();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');

  const onCredentials = (event: FormEvent) => {
    event.preventDefault();
    void submitPassword(identifier.trim(), password);
  };

  const onTwoFactor = (event: FormEvent) => {
    event.preventDefault();
    void submitTwoFactor({ token: code.trim() });
  };

  if (phase === 'twoFactor') {
    return (
      <form onSubmit={onTwoFactor}>
        <p style={{ fontSize: 14, color: '#4b5563', margin: 0 }}>
          Enter the 6-digit code from your authenticator app.
        </p>
        <input
          style={inputStyle}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          aria-label="Two-factor code"
        />
        {error ? <div style={errorStyle}>{error}</div> : null}
        <button type="submit" style={primaryButtonStyle} disabled={isSubmitting}>
          {isSubmitting ? 'Verifying…' : 'Verify'}
        </button>
        <button type="button" style={linkButtonStyle} onClick={reset}>
          Back
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={onCredentials}>
      <input
        style={inputStyle}
        value={identifier}
        onChange={(e) => setIdentifier(e.target.value)}
        autoComplete="username"
        placeholder="Username or email"
        aria-label="Username or email"
      />
      <input
        style={inputStyle}
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
        placeholder="Password"
        aria-label="Password"
      />
      {error ? <div style={errorStyle}>{error}</div> : null}
      <button type="submit" style={primaryButtonStyle} disabled={isSubmitting}>
        {isSubmitting ? 'Signing in…' : 'Sign in'}
      </button>
      <button type="button" style={linkButtonStyle} onClick={onClose}>
        Cancel
      </button>
    </form>
  );
}

function QrPanel() {
  const { phase, qrImageDataUrl, error } = useCommonsSignIn({ autoStart: true });

  return (
    <div style={{ textAlign: 'center' }}>
      <p style={{ fontSize: 14, color: '#4b5563', marginTop: 0 }}>
        Scan this code with the Oxy app on your phone.
      </p>
      {qrImageDataUrl ? (
        <img
          src={qrImageDataUrl}
          alt="Sign in with Oxy QR code"
          width={220}
          height={220}
          style={{ borderRadius: 12 }}
        />
      ) : (
        <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af' }}>
          {phase === 'error' ? 'Unable to start' : 'Preparing…'}
        </div>
      )}
      {error ? <div style={errorStyle}>{error}</div> : null}
    </div>
  );
}

function OxySignInModalContent({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<'password' | 'qr'>('password');

  // The non-modal <dialog open> does not receive the browser's native
  // Escape/cancel handling (that is showModal()-only), so wire Escape-to-close
  // explicitly for keyboard accessibility. Mounted only while open, so the
  // listener lifecycle matches the modal's.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div style={overlayStyle}>
      {/* Click-outside-to-close: a real <button> (keyboard-accessible) sitting
          BEHIND the card, so no click handler is needed on any static div. */}
      <button type="button" aria-label="Close sign in" style={backdropStyle} onClick={onClose} />
      <dialog open aria-label="Sign in with Oxy" style={cardStyle}>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0, marginBottom: 16 }}>
          Sign in with Oxy
        </h2>
        {mode === 'password' ? <PasswordForm onClose={onClose} /> : <QrPanel />}
        <div style={{ marginTop: 20, borderTop: '1px solid #eee', paddingTop: 12, textAlign: 'center' }}>
          {mode === 'password' ? (
            <button type="button" style={linkButtonStyle} onClick={() => setMode('qr')}>
              Use a QR code instead
            </button>
          ) : (
            <button type="button" style={linkButtonStyle} onClick={() => setMode('password')}>
              Use a password instead
            </button>
          )}
        </div>
      </dialog>
    </div>
  );
}

export function OxySignInModal({ open, onClose }: OxySignInModalProps) {
  if (!open) {
    return null;
  }
  return <OxySignInModalContent onClose={onClose} />;
}

export default OxySignInModal;
