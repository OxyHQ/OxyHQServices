/**
 * OxySignInModal — the in-app "Sign in with Oxy" UI.
 *
 * Rendered by {@link WebOxyProvider} out-of-the-box (opened by `signIn()`), and
 * exported so a consumer can render it directly. Dependency-free by design (no
 * CSS framework, no `react-dom` portal — a fixed-position overlay covers the
 * viewport regardless of DOM nesting; a single scoped `<style>` block carries
 * the theme so it stays self-contained, themeable, and replaceable). Any
 * consumer that wants a fully branded experience can ignore it and build their
 * own UI over the headless {@link useOxySignIn} + {@link useCommonsSignIn}
 * hooks + the provider's `accounts` / `switchAccount` surface.
 *
 * Views:
 *   - Account chooser (Google-style) — shown FIRST when the provider knows about
 *     device accounts: one-tap `switchAccount`, the active account marked, and a
 *     "Use another account" affordance into the sign-in view.
 *   - Sign-in — password (with a 2FA step) or the cross-device QR handoff. Shown
 *     directly when there are no device accounts.
 *
 * The content is mounted only while `open` is true, so every open starts fresh.
 * Escape-to-close + a focus trap keep it accessible; light/dark follow
 * `prefers-color-scheme`.
 */

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useOxySignIn } from '../hooks/useOxySignIn';
import { useCommonsSignIn } from '../hooks/useCommonsSignIn';
import { useWebOxyOptional } from '../WebOxyProvider';
import type { DeviceAccountView } from '../session/deviceAccountsProjection';

export interface OxySignInModalProps {
  open: boolean;
  onClose: () => void;
}

/** Focusable-element selector for the dialog's mount-focus + Tab trap. */
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Scoped theme + layout. All rules are namespaced under `.oxysi-root`, and the
 * palette is a set of CSS custom properties overridden under
 * `prefers-color-scheme: dark` — the ONE place the modal's look lives, so a
 * consumer can restyle by shadowing these selectors or replacing the component.
 * Values mirror the Bloom "oxy" preset (hue 277).
 */
const MODAL_CSS = `
.oxysi-root{
  --oxysi-bg:hsl(277 55% 98%);
  --oxysi-fg:hsl(0 0% 12%);
  --oxysi-muted:hsl(277 6% 44%);
  --oxysi-border:hsl(277 40% 89%);
  --oxysi-hover:hsl(277 55% 95%);
  --oxysi-input-bg:hsl(0 0% 100%);
  --oxysi-primary:hsl(277 66% 56%);
  --oxysi-primary-hover:hsl(277 66% 50%);
  --oxysi-primary-fg:hsl(0 0% 100%);
  --oxysi-danger:hsl(0 74% 52%);
  position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
}
.oxysi-backdrop{position:absolute;inset:0;margin:0;padding:0;border:none;background:rgba(15,10,20,.55);cursor:default;-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);}
.oxysi-card{position:relative;z-index:1;margin:0;width:100%;max-width:400px;max-height:calc(100vh - 32px);overflow-y:auto;box-sizing:border-box;
  background:var(--oxysi-bg);color:var(--oxysi-fg);border:1px solid var(--oxysi-border);border-radius:20px;padding:28px 24px;
  box-shadow:0 24px 70px -12px rgba(30,10,50,.35);animation:oxysi-pop .18s cubic-bezier(.2,.9,.3,1.1);}
@keyframes oxysi-pop{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
.oxysi-close{position:absolute;top:14px;right:14px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;
  border:none;background:transparent;color:var(--oxysi-muted);border-radius:9px;cursor:pointer;font-size:20px;line-height:1;}
.oxysi-close:hover{background:var(--oxysi-hover);color:var(--oxysi-fg);}
.oxysi-head{text-align:center;margin:2px 0 20px;}
.oxysi-logo{width:44px;height:44px;border-radius:12px;margin:0 auto 14px;display:flex;align-items:center;justify-content:center;
  background:var(--oxysi-primary);color:var(--oxysi-primary-fg);font-weight:800;font-size:20px;}
.oxysi-title{font-size:19px;font-weight:700;margin:0;letter-spacing:-.01em;}
.oxysi-sub{font-size:14px;color:var(--oxysi-muted);margin:6px 0 0;}
.oxysi-list{display:flex;flex-direction:column;gap:8px;}
.oxysi-row{display:flex;align-items:center;gap:12px;width:100%;box-sizing:border-box;text-align:left;
  padding:10px 12px;border:1px solid var(--oxysi-border);border-radius:14px;background:transparent;color:inherit;cursor:pointer;
  transition:background .12s,border-color .12s,transform .06s;}
.oxysi-row:hover{background:var(--oxysi-hover);border-color:var(--oxysi-primary);}
.oxysi-row:active{transform:scale(.99);}
.oxysi-row:disabled{opacity:.55;cursor:default;}
.oxysi-avatar{width:40px;height:40px;border-radius:50%;flex-shrink:0;object-fit:cover;display:flex;align-items:center;justify-content:center;
  background:var(--oxysi-primary);color:var(--oxysi-primary-fg);font-weight:700;font-size:15px;text-transform:uppercase;overflow:hidden;}
.oxysi-rowtext{flex:1;min-width:0;}
.oxysi-name{font-weight:600;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.oxysi-handle{font-size:13px;color:var(--oxysi-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.oxysi-badge{font-size:11px;font-weight:600;color:var(--oxysi-primary);flex-shrink:0;}
.oxysi-chev{flex-shrink:0;color:var(--oxysi-muted);}
.oxysi-addicon{width:40px;height:40px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;
  background:var(--oxysi-hover);color:var(--oxysi-muted);}
.oxysi-input{width:100%;box-sizing:border-box;margin-top:10px;padding:11px 13px;border-radius:12px;border:1px solid var(--oxysi-border);
  background:var(--oxysi-input-bg);color:var(--oxysi-fg);font-size:15px;outline:none;transition:border-color .12s,box-shadow .12s;}
.oxysi-input:focus{border-color:var(--oxysi-primary);box-shadow:0 0 0 3px hsl(277 66% 56% / .18);}
.oxysi-primarybtn{width:100%;box-sizing:border-box;margin-top:16px;padding:12px;border:none;border-radius:12px;
  background:var(--oxysi-primary);color:var(--oxysi-primary-fg);font-size:15px;font-weight:600;cursor:pointer;transition:background .12s;}
.oxysi-primarybtn:hover{background:var(--oxysi-primary-hover);}
.oxysi-primarybtn:disabled{opacity:.65;cursor:default;}
.oxysi-link{display:inline-block;background:none;border:none;color:var(--oxysi-primary);font-size:14px;font-weight:500;cursor:pointer;padding:6px;margin-top:6px;}
.oxysi-link:hover{text-decoration:underline;}
.oxysi-error{color:var(--oxysi-danger);font-size:13px;margin-top:12px;text-align:center;}
.oxysi-foot{margin-top:18px;padding-top:14px;border-top:1px solid var(--oxysi-border);text-align:center;}
.oxysi-qrwrap{text-align:center;}
.oxysi-qrimg{border-radius:14px;border:1px solid var(--oxysi-border);}
.oxysi-qrph{height:220px;display:flex;align-items:center;justify-content:center;color:var(--oxysi-muted);
  border:1px dashed var(--oxysi-border);border-radius:14px;}
@media (prefers-color-scheme: dark){
  .oxysi-root{
    --oxysi-bg:hsl(277 22% 15%);
    --oxysi-fg:hsl(0 0% 94%);
    --oxysi-muted:hsl(0 0% 68%);
    --oxysi-border:hsl(277 14% 26%);
    --oxysi-hover:hsl(277 18% 22%);
    --oxysi-input-bg:hsl(277 12% 19%);
    --oxysi-danger:hsl(0 84% 68%);
  }
  .oxysi-card{box-shadow:0 24px 70px -12px rgba(0,0,0,.6);}
}
`;

/** displayName ?? handle policy for a device account row. */
function accountDisplay(account: DeviceAccountView['user']): { primary: string; handle: string } {
  const handle = account?.username ? `@${account.username}` : '';
  const name = account?.name?.displayName?.trim();
  return { primary: name || handle || 'Account', handle };
}

function AccountAvatar({ account, avatarUrl }: { account: DeviceAccountView['user']; avatarUrl: string | null }) {
  const { primary } = accountDisplay(account);
  const initial = primary.replace(/^@/, '').charAt(0) || '?';
  if (avatarUrl) {
    return <img className="oxysi-avatar" src={avatarUrl} alt="" width={40} height={40} />;
  }
  return <span className="oxysi-avatar" aria-hidden="true">{initial}</span>;
}

function ChooserView({
  accounts,
  activeAuthuser,
  avatarUrlFor,
  onSelect,
  onUseAnother,
  pendingAuthuser,
}: {
  accounts: DeviceAccountView[];
  activeAuthuser: number | null;
  avatarUrlFor: (account: DeviceAccountView['user']) => string | null;
  onSelect: (authuser: number) => void;
  onUseAnother: () => void;
  pendingAuthuser: number | null;
}) {
  return (
    <div>
      <div className="oxysi-head">
        <span className="oxysi-logo" aria-hidden="true">O</span>
        <p className="oxysi-title">Choose an account</p>
        <p className="oxysi-sub">to continue with Oxy</p>
      </div>
      <div className="oxysi-list">
        {accounts.map((entry) => {
          const { primary, handle } = accountDisplay(entry.user);
          const isActive = entry.authuser === activeAuthuser;
          return (
            <button
              key={entry.sessionId}
              type="button"
              className="oxysi-row"
              onClick={() => onSelect(entry.authuser)}
              disabled={pendingAuthuser !== null}
              aria-label={`Continue as ${primary}`}
            >
              <AccountAvatar account={entry.user} avatarUrl={avatarUrlFor(entry.user)} />
              <span className="oxysi-rowtext">
                <span className="oxysi-name">{primary}</span>
                {handle && primary !== handle ? <span className="oxysi-handle">{handle}</span> : null}
              </span>
              {pendingAuthuser === entry.authuser ? (
                <span className="oxysi-badge">…</span>
              ) : isActive ? (
                <span className="oxysi-badge">Active</span>
              ) : null}
              <svg className="oxysi-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          );
        })}
        <button type="button" className="oxysi-row" onClick={onUseAnother} disabled={pendingAuthuser !== null}>
          <span className="oxysi-addicon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </span>
          <span className="oxysi-rowtext">
            <span className="oxysi-name">Use another account</span>
          </span>
          <svg className="oxysi-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function PasswordForm({ onDone, onBack }: { onDone: () => void; onBack?: () => void }) {
  const { phase, error, isSubmitting, submitPassword, submitTwoFactor, reset } = useOxySignIn();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');

  // A committed sign-in closes the modal (the provider flips isSignInOpen; this
  // is a belt-and-suspenders for standalone use).
  useEffect(() => {
    if (phase === 'authorized') onDone();
  }, [phase, onDone]);

  if (phase === 'twoFactor') {
    return (
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); void submitTwoFactor({ token: code.trim() }); }}>
        <p className="oxysi-sub" style={{ marginTop: 0 }}>Enter the 6-digit code from your authenticator app.</p>
        <input
          className="oxysi-input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          aria-label="Two-factor code"
        />
        {error ? <div className="oxysi-error">{error}</div> : null}
        <button type="submit" className="oxysi-primarybtn" disabled={isSubmitting}>
          {isSubmitting ? 'Verifying…' : 'Verify'}
        </button>
        <div style={{ textAlign: 'center' }}>
          <button type="button" className="oxysi-link" onClick={reset}>Back</button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); void submitPassword(identifier.trim(), password); }}>
      <input
        className="oxysi-input"
        value={identifier}
        onChange={(e) => setIdentifier(e.target.value)}
        autoComplete="username"
        placeholder="Username or email"
        aria-label="Username or email"
      />
      <input
        className="oxysi-input"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
        placeholder="Password"
        aria-label="Password"
      />
      {error ? <div className="oxysi-error">{error}</div> : null}
      <button type="submit" className="oxysi-primarybtn" disabled={isSubmitting}>
        {isSubmitting ? 'Signing in…' : 'Continue'}
      </button>
      {onBack ? (
        <div style={{ textAlign: 'center' }}>
          <button type="button" className="oxysi-link" onClick={onBack}>Back to accounts</button>
        </div>
      ) : null}
    </form>
  );
}

function QrPanel() {
  const { phase, qrImageDataUrl, error } = useCommonsSignIn({ autoStart: true });
  return (
    <div className="oxysi-qrwrap">
      <p className="oxysi-sub" style={{ marginTop: 0 }}>Scan this code with the Oxy app on your phone.</p>
      {qrImageDataUrl ? (
        <img className="oxysi-qrimg" src={qrImageDataUrl} alt="Sign in with Oxy QR code" width={220} height={220} />
      ) : (
        <div className="oxysi-qrph">{phase === 'error' ? 'Unable to start' : 'Preparing…'}</div>
      )}
      {error ? <div className="oxysi-error">{error}</div> : null}
    </div>
  );
}

function SignInView({ onDone, onBack }: { onDone: () => void; onBack?: () => void }) {
  const [mode, setMode] = useState<'password' | 'qr'>('password');
  return (
    <div>
      <div className="oxysi-head">
        <span className="oxysi-logo" aria-hidden="true">O</span>
        <p className="oxysi-title">Sign in with Oxy</p>
        <p className="oxysi-sub">Use your Oxy account to continue</p>
      </div>
      {mode === 'password' ? <PasswordForm onDone={onDone} onBack={onBack} /> : <QrPanel />}
      <div className="oxysi-foot">
        {mode === 'password' ? (
          <button type="button" className="oxysi-link" onClick={() => setMode('qr')}>Sign in with a QR code</button>
        ) : (
          <button type="button" className="oxysi-link" onClick={() => setMode('password')}>Use a password instead</button>
        )}
      </div>
    </div>
  );
}

function OxySignInModalContent({ onClose }: { onClose: () => void }) {
  const ctx = useWebOxyOptional();
  const accounts = ctx?.accounts ?? [];
  const activeAuthuser = ctx?.activeAuthuser ?? null;
  const switchAccount = ctx?.switchAccount;
  const oxyServices = ctx?.oxyServices;

  const [view, setView] = useState<'chooser' | 'signin'>(accounts.length > 0 ? 'chooser' : 'signin');
  const [pendingAuthuser, setPendingAuthuser] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const avatarUrlFor = useMemo(
    () => (account: DeviceAccountView['user']): string | null => {
      if (!account?.avatar || !oxyServices) return null;
      try {
        return oxyServices.getFileDownloadUrl(account.avatar) || null;
      } catch {
        return null;
      }
    },
    [oxyServices],
  );

  // Move focus into the dialog on mount and whenever the view swaps — the
  // sign-in view leads with its first input, the chooser with its first row.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const selector = view === 'signin' ? `input:not([disabled]), ${FOCUSABLE}` : FOCUSABLE;
    dialog.querySelector<HTMLElement>(selector)?.focus();
  }, [view]);

  // Escape-to-close (the non-modal <dialog open> gets no native cancel) + a
  // focus trap (Tab wrap). The focusable set is read live at keydown time, so
  // this listener does not need to re-bind on view change.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleSelect = (authuser: number) => {
    if (authuser === activeAuthuser || !switchAccount) {
      onClose();
      return;
    }
    setPendingAuthuser(authuser);
    void Promise.resolve(switchAccount(authuser)).finally(() => {
      setPendingAuthuser(null);
      onClose();
    });
  };

  return (
    <div className="oxysi-root">
      <style>{MODAL_CSS}</style>
      {/* Mouse-only click-outside close (kept out of the tab order; the header
          × button is the keyboard-accessible close inside the focus trap). */}
      <button type="button" className="oxysi-backdrop" tabIndex={-1} aria-hidden="true" onClick={onClose} />
      <dialog ref={dialogRef} open aria-label="Sign in with Oxy" className="oxysi-card">
        <button type="button" className="oxysi-close" aria-label="Close" onClick={onClose}>×</button>
        {view === 'chooser' && accounts.length > 0 ? (
          <ChooserView
            accounts={accounts}
            activeAuthuser={activeAuthuser}
            avatarUrlFor={avatarUrlFor}
            onSelect={handleSelect}
            onUseAnother={() => setView('signin')}
            pendingAuthuser={pendingAuthuser}
          />
        ) : (
          <SignInView
            onDone={onClose}
            onBack={accounts.length > 0 ? () => setView('chooser') : undefined}
          />
        )}
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
