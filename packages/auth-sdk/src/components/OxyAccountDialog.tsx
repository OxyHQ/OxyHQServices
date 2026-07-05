/**
 * OxyAccountDialog — the unified in-app account dialog (web).
 *
 * ONE dialog for switching accounts AND signing in, bound to the headless
 * {@link AccountDialogController} in `@oxyhq/core` via `useSyncExternalStore`.
 * It replaces the five drifting account-chooser copies with a single web
 * binding that shares its state machine + account-list projection
 * (`projectSwitchableAccounts`) with the React Native binding in
 * `@oxyhq/services` and with auth.oxy.so.
 *
 * Views (driven by `controller.getSnapshot().view`):
 *   - `accounts` — the switchable list: avatar + display name + handle + chevron
 *     rows, the active one marked, per-account hover re-theming, a "+ Add
 *     account" affordance, and "Sign out everywhere". A one-tap on a row is the
 *     UNIFORM switch (`controller.switchTo(accountId)`).
 *   - `signin` / `add` — the sign-in entry: primary "Sign in with Oxy"
 *     (`signInWithOxy`), "Scan a QR code" (`showQr`), and a secondary "Use a
 *     password" that hands off to auth.oxy.so (`openPasswordAtOxyAuth`). Password
 *     + 2FA are NOT in the SDK — they live at the IdP.
 *   - `qr` — renders the cross-device handoff payload (`signIn.qrPayload`).
 *
 * Dependency-free by design (no CSS framework, no `react-dom` portal): a fixed
 * overlay + a single scoped `<style>` block carry the Bloom-token look so the
 * dialog stays self-contained, themeable, and replaceable. Per-account accent
 * re-theming is done with inline CSS custom properties derived from the
 * account's Bloom color preset — the same `APP_COLOR_PRESETS` hues auth.oxy.so
 * uses, inlined here to keep `@oxyhq/auth` bloom-free (RN-free, dependency-light).
 *
 * The content is mounted only while `open` is true, so every open starts fresh.
 * Escape-to-close + a focus trap keep it accessible; light/dark follow
 * `prefers-color-scheme`.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from 'react';
import type { AccountDialogController, SwitchableAccount } from '@oxyhq/core';
import { renderQrDataUrl } from '../utils/qrCode';
import { useWebOxyOptional } from '../WebOxyProvider';

export interface OxyAccountDialogProps {
  open: boolean;
  onClose: () => void;
  /**
   * The controller to bind to. Omit inside a {@link WebOxyProvider} to use the
   * provider's controller (resolved from context). Passing it explicitly lets a
   * consumer render the dialog standalone over its own controller instance.
   */
  controller?: AccountDialogController;
}

/** Focusable-element selector for the dialog's mount-focus + Tab trap. */
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Primary HSL triple (`h s% l%`, light mode) per Bloom color preset — mirrors
 * `@oxyhq/bloom` `APP_COLOR_PRESETS[name].light['--primary']`. `@oxyhq/auth` is
 * intentionally bloom-free (RN-first package; dependency-light web SDK), so this
 * compact table is the ONE duplication and drives cosmetic per-account accent
 * re-theming only. Unknown / unset colors fall back to `oxy`.
 */
const PRESET_HSL: Record<string, readonly [number, number, number]> = {
  teal: [185, 100, 20],
  blue: [205, 87, 53],
  green: [160, 84, 39],
  amber: [38, 92, 50],
  yellow: [46, 100, 50],
  red: [0, 84, 60],
  purple: [258, 90, 66],
  pink: [330, 81, 60],
  sky: [199, 89, 48],
  orange: [25, 95, 53],
  mint: [173, 80, 40],
  oxy: [277, 66, 56],
  faircoin: [92, 90, 25],
};

const OXY_HSL = PRESET_HSL.oxy;

function hslOf(color: string | null | undefined): readonly [number, number, number] {
  return (color ? PRESET_HSL[color] : undefined) ?? OXY_HSL;
}

/** The account's primary accent as a resolved `hsl(...)` string for the mode. */
function primaryHsl(color: string | null | undefined, isDark: boolean): string {
  const [h, s, l] = hslOf(color);
  const lightness = isDark ? Math.min(l + 16, 72) : l;
  return `hsl(${h} ${s}% ${lightness}%)`;
}

/**
 * The full accent CSS custom-property set for a color preset, resolved for the
 * current color scheme. Applied inline on the card so the whole dialog chrome
 * re-themes to the hovered (or active) account. The literal is asserted to
 * `CSSProperties` because `@types/react` intentionally dropped the custom-property
 * index signature (an object with only `--*` keys is structurally assignable).
 */
function accentStyle(color: string | null | undefined, isDark: boolean): CSSProperties {
  const [h, s, l] = hslOf(color);
  if (isDark) {
    const base = Math.min(l + 16, 72);
    return {
      '--oxyad-primary': `hsl(${h} ${s}% ${base}%)`,
      '--oxyad-primary-hover': `hsl(${h} ${s}% ${Math.min(base + 6, 80)}%)`,
      '--oxyad-soft': `hsl(${h} 32% 20%)`,
      '--oxyad-ring': `hsl(${h} ${s}% ${base}% / 0.4)`,
    } as CSSProperties;
  }
  return {
    '--oxyad-primary': `hsl(${h} ${s}% ${l}%)`,
    '--oxyad-primary-hover': `hsl(${h} ${s}% ${Math.max(l - 8, 12)}%)`,
    '--oxyad-soft': `hsl(${h} 66% 96%)`,
    '--oxyad-ring': `hsl(${h} ${s}% ${l}% / 0.32)`,
  } as CSSProperties;
}

/**
 * Scoped theme + layout, namespaced under `.oxyad-root`. Neutral palette lives
 * in CSS custom properties (light + `prefers-color-scheme: dark`); the ACCENT
 * set (`--oxyad-primary` / `-hover` / `--oxyad-soft` / `--oxyad-ring`) defaults
 * to the `oxy` preset here and is overridden inline on the card per account.
 */
const DIALOG_CSS = `
.oxyad-root{
  --oxyad-bg:hsl(270 30% 98.5%);
  --oxyad-fg:hsl(268 28% 12%);
  --oxyad-muted:hsl(268 10% 46%);
  --oxyad-border:hsl(268 24% 88%);
  --oxyad-hover:hsl(268 30% 96%);
  --oxyad-input-bg:hsl(268 30% 97%);
  --oxyad-danger:hsl(352 70% 52%);
  --oxyad-on-primary:hsl(0 0% 100%);
  --oxyad-primary:hsl(277 66% 56%);
  --oxyad-primary-hover:hsl(277 66% 48%);
  --oxyad-soft:hsl(277 66% 96%);
  --oxyad-ring:hsl(277 66% 56% / 0.32);
  position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
}
.oxyad-backdrop{position:absolute;inset:0;margin:0;padding:0;border:none;background:hsl(268 40% 12% / 0.55);cursor:default;
  -webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);}
.oxyad-card{position:relative;z-index:1;margin:0;width:100%;max-width:400px;max-height:calc(100vh - 32px);overflow-y:auto;box-sizing:border-box;
  background:var(--oxyad-bg);color:var(--oxyad-fg);border:1px solid var(--oxyad-border);border-radius:22px;padding:28px 24px 22px;
  box-shadow:0 30px 80px -20px hsl(268 45% 18% / 0.4);animation:oxyad-pop .18s cubic-bezier(.2,.9,.3,1.1);}
@keyframes oxyad-pop{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
.oxyad-close,.oxyad-back{position:absolute;top:16px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;
  border:none;background:transparent;color:var(--oxyad-muted);border-radius:999px;cursor:pointer;font-size:20px;line-height:1;}
.oxyad-close{right:16px;}
.oxyad-back{left:16px;}
.oxyad-close:hover,.oxyad-back:hover{background:var(--oxyad-soft);color:var(--oxyad-primary-hover);}
.oxyad-head{text-align:center;margin:4px 0 20px;}
.oxyad-logo{width:46px;height:46px;border-radius:14px;margin:0 auto 14px;display:flex;align-items:center;justify-content:center;
  background:var(--oxyad-primary);color:var(--oxyad-on-primary);font-weight:800;font-size:20px;box-shadow:0 8px 20px var(--oxyad-ring);}
.oxyad-title{font-size:22px;font-weight:800;margin:0;letter-spacing:-.02em;}
.oxyad-sub{font-size:14px;color:var(--oxyad-muted);margin:6px 0 0;}
.oxyad-list{display:flex;flex-direction:column;gap:8px;}
.oxyad-row{display:flex;align-items:center;gap:12px;width:100%;box-sizing:border-box;text-align:left;
  padding:11px 12px;border:1px solid var(--oxyad-border);border-radius:14px;background:transparent;color:inherit;cursor:pointer;
  transition:background .14s,border-color .14s,box-shadow .14s,transform .06s;}
.oxyad-row:hover{background:var(--oxyad-soft);border-color:var(--oxyad-primary);box-shadow:0 6px 18px var(--oxyad-ring);}
.oxyad-row:active{transform:scale(.99);}
.oxyad-row:disabled{opacity:.55;cursor:default;}
.oxyad-row.active{border-color:var(--oxyad-primary);}
.oxyad-avatar{width:40px;height:40px;border-radius:50%;flex-shrink:0;object-fit:cover;display:flex;align-items:center;justify-content:center;
  color:hsl(0 0% 100%);font-weight:700;font-size:15px;text-transform:uppercase;overflow:hidden;}
.oxyad-rowtext{flex:1;min-width:0;}
.oxyad-name{font-weight:650;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.oxyad-handle{font-size:12.5px;color:var(--oxyad-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.oxyad-badge{font-size:11px;font-weight:700;color:var(--oxyad-primary-hover);background:var(--oxyad-soft);padding:2px 8px;border-radius:999px;flex-shrink:0;}
.oxyad-chev{flex-shrink:0;color:var(--oxyad-muted);}
.oxyad-addicon{width:40px;height:40px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;
  background:var(--oxyad-hover);color:var(--oxyad-muted);border:1px dashed var(--oxyad-border);}
.oxyad-primarybtn{width:100%;box-sizing:border-box;margin-top:14px;padding:13px;border:none;border-radius:14px;
  background:var(--oxyad-primary);color:var(--oxyad-on-primary);font-size:15px;font-weight:700;cursor:pointer;
  display:flex;align-items:center;justify-content:center;gap:9px;box-shadow:0 8px 20px var(--oxyad-ring);transition:background .14s,transform .1s;}
.oxyad-primarybtn:hover{background:var(--oxyad-primary-hover);}
.oxyad-primarybtn:active{transform:scale(.985);}
.oxyad-primarybtn:disabled{opacity:.65;cursor:default;}
.oxyad-ghostbtn{width:100%;box-sizing:border-box;margin-top:10px;padding:12px;border:1px solid var(--oxyad-border);border-radius:14px;
  background:transparent;color:var(--oxyad-primary-hover);font-size:15px;font-weight:650;cursor:pointer;
  display:flex;align-items:center;justify-content:center;gap:9px;transition:background .14s,border-color .14s;}
.oxyad-ghostbtn:hover{background:var(--oxyad-soft);border-color:var(--oxyad-primary);}
.oxyad-divider{display:flex;align-items:center;gap:12px;color:var(--oxyad-muted);font-size:12px;margin:16px 0 6px;}
.oxyad-divider::before,.oxyad-divider::after{content:"";height:1px;background:var(--oxyad-border);flex:1;}
.oxyad-link{display:inline-block;background:none;border:none;color:var(--oxyad-primary-hover);font-size:14px;font-weight:600;cursor:pointer;padding:6px;}
.oxyad-link:hover{text-decoration:underline;}
.oxyad-micro{text-align:center;font-size:13px;color:var(--oxyad-muted);margin-top:16px;}
.oxyad-foot{margin-top:16px;padding-top:14px;border-top:1px solid var(--oxyad-border);text-align:center;
  display:flex;flex-wrap:wrap;gap:2px 10px;justify-content:center;}
.oxyad-error{color:var(--oxyad-danger);font-size:13px;margin-top:12px;text-align:center;}
.oxyad-qrwrap{text-align:center;}
.oxyad-qrimg{border-radius:16px;border:1px solid var(--oxyad-border);background:hsl(0 0% 100%);padding:8px;}
.oxyad-qrph{height:200px;display:flex;align-items:center;justify-content:center;color:var(--oxyad-muted);
  border:1px dashed var(--oxyad-border);border-radius:16px;}
@media (prefers-color-scheme: dark){
  .oxyad-root{
    --oxyad-bg:hsl(268 20% 12.5%);
    --oxyad-fg:hsl(266 30% 95%);
    --oxyad-muted:hsl(266 12% 62%);
    --oxyad-border:hsl(268 18% 24%);
    --oxyad-hover:hsl(268 18% 20%);
    --oxyad-input-bg:hsl(268 16% 18%);
    --oxyad-danger:hsl(352 80% 68%);
    --oxyad-primary:hsl(277 72% 68%);
    --oxyad-primary-hover:hsl(277 74% 74%);
    --oxyad-soft:hsl(277 32% 20%);
    --oxyad-ring:hsl(277 72% 68% / 0.4);
  }
  .oxyad-card{box-shadow:0 30px 80px -20px hsl(0 0% 0% / 0.6);}
}
`;

const ChevronIcon = () => (
  <svg className="oxyad-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** displayName (never blank) + `@handle` secondary line for a switchable account. */
function rowLabels(account: SwitchableAccount): { primary: string; secondary: string } {
  const username = account.user?.username;
  const secondary = username ? `@${username}` : (account.email ?? '');
  return { primary: account.displayName, secondary };
}

function AccountRow({
  account,
  isDark,
  disabled,
  pending,
  onSelect,
  onHover,
  onHoverEnd,
}: {
  account: SwitchableAccount;
  isDark: boolean;
  disabled: boolean;
  pending: boolean;
  onSelect: () => void;
  onHover: () => void;
  onHoverEnd: () => void;
}) {
  const { primary, secondary } = rowLabels(account);
  const initial = primary.replace(/^@/, '').charAt(0) || '?';
  return (
    <button
      type="button"
      className={`oxyad-row${account.isCurrent ? ' active' : ''}`}
      onClick={onSelect}
      onMouseEnter={onHover}
      onMouseLeave={onHoverEnd}
      onFocus={onHover}
      onBlur={onHoverEnd}
      disabled={disabled}
      aria-label={account.isCurrent ? `Continue as ${primary}` : `Switch to ${primary}`}
    >
      {account.avatarUrl ? (
        <img className="oxyad-avatar" src={account.avatarUrl} alt="" width={40} height={40} />
      ) : (
        <span className="oxyad-avatar" style={{ backgroundColor: primaryHsl(account.color, isDark) }} aria-hidden="true">
          {initial}
        </span>
      )}
      <span className="oxyad-rowtext">
        <span className="oxyad-name">{primary}</span>
        {secondary && secondary !== primary ? <span className="oxyad-handle">{secondary}</span> : null}
      </span>
      {pending ? (
        <span className="oxyad-badge">…</span>
      ) : account.isCurrent ? (
        <span className="oxyad-badge">Active</span>
      ) : (
        <ChevronIcon />
      )}
    </button>
  );
}

function AccountsView({
  accounts,
  isDark,
  switchingAccountId,
  error,
  onSelect,
  onAdd,
  onHover,
  onHoverEnd,
  onSignOutAll,
}: {
  accounts: SwitchableAccount[];
  isDark: boolean;
  switchingAccountId: string | null;
  error: string | null;
  onSelect: (account: SwitchableAccount) => void;
  onAdd: () => void;
  onHover: (color: string | null) => void;
  onHoverEnd: () => void;
  onSignOutAll: (() => void) | undefined;
}) {
  const busy = switchingAccountId !== null;
  return (
    <div>
      <div className="oxyad-head">
        <span className="oxyad-logo" aria-hidden="true">O</span>
        <p className="oxyad-title">Your accounts</p>
        <p className="oxyad-sub">Choose one to continue</p>
      </div>
      <div className="oxyad-list">
        {accounts.map((account) => (
          <AccountRow
            key={account.accountId}
            account={account}
            isDark={isDark}
            disabled={busy}
            pending={switchingAccountId === account.accountId}
            onSelect={() => onSelect(account)}
            onHover={() => onHover(account.color)}
            onHoverEnd={onHoverEnd}
          />
        ))}
        <button
          type="button"
          className="oxyad-row"
          onClick={onAdd}
          onMouseEnter={onHoverEnd}
          onFocus={onHoverEnd}
          disabled={busy}
        >
          <span className="oxyad-addicon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </span>
          <span className="oxyad-rowtext">
            <span className="oxyad-name">Add account</span>
          </span>
          <ChevronIcon />
        </button>
      </div>
      {error ? <div className="oxyad-error">{error}</div> : null}
      {onSignOutAll ? (
        <div className="oxyad-micro">
          <button type="button" className="oxyad-link" onClick={onSignOutAll}>Sign out everywhere</button>
        </div>
      ) : null}
    </div>
  );
}

function SignInEntryView({
  onSignInWithOxy,
  onScanQr,
  onUsePassword,
}: {
  onSignInWithOxy: () => void;
  onScanQr: () => void;
  onUsePassword: () => void;
}) {
  return (
    <div>
      <div className="oxyad-head">
        <span className="oxyad-logo" aria-hidden="true">O</span>
        <p className="oxyad-title">Sign in with Oxy</p>
        <p className="oxyad-sub">One identity for the whole ecosystem</p>
      </div>
      <button type="button" className="oxyad-primarybtn" onClick={onSignInWithOxy}>
        Sign in with Oxy
      </button>
      <button type="button" className="oxyad-ghostbtn" onClick={onScanQr}>
        Scan a QR code from another device
      </button>
      <div className="oxyad-divider">or</div>
      <div className="oxyad-micro">
        Prefer a username and password?{' '}
        <button type="button" className="oxyad-link" onClick={onUsePassword}>Open auth.oxy.so</button>
      </div>
    </div>
  );
}

function QrImage({ payload }: { payload: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  // Async render of the QR bitmap keyed on the payload — a genuine derived
  // resource (not prop→state mirroring). Superseded renders are dropped.
  useEffect(() => {
    let alive = true;
    setDataUrl(null);
    renderQrDataUrl(payload, 200)
      .then((url) => { if (alive) setDataUrl(url); })
      .catch(() => { if (alive) setDataUrl(null); });
    return () => { alive = false; };
  }, [payload]);

  return dataUrl ? (
    <img className="oxyad-qrimg" src={dataUrl} alt="Sign in with Oxy QR code" width={200} height={200} />
  ) : (
    <div className="oxyad-qrph">Preparing…</div>
  );
}

function QrView({ payload, error }: { payload: string | null; error: string | null }) {
  return (
    <div>
      <div className="oxyad-head">
        <span className="oxyad-logo" aria-hidden="true">O</span>
        <p className="oxyad-title">Scan with Oxy</p>
        <p className="oxyad-sub">Approve from your phone</p>
      </div>
      <div className="oxyad-qrwrap">
        {payload ? <QrImage payload={payload} /> : <div className="oxyad-qrph">{error ? 'Unable to start' : 'Preparing…'}</div>}
      </div>
      {error ? <div className="oxyad-error">{error}</div> : null}
      <div className="oxyad-micro">Open Commons or any Oxy app, scan, and approve with biometrics.</div>
    </div>
  );
}

function OxyAccountDialogContent({ controller, onClose }: { controller: AccountDialogController; onClose: () => void }) {
  const subscribe = useCallback((listener: () => void) => controller.subscribe(listener), [controller]);
  const getSnapshot = useCallback(() => controller.getSnapshot(), [controller]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  const isDark = usePrefersDark();

  const [hoverColor, setHoverColor] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const { view, accounts, switchingAccountId, error, signIn } = snapshot;
  // Sign-in entry when explicitly requested OR when there is no account to show.
  const isSignInEntry = view === 'signin' || (view !== 'qr' && accounts.length === 0);
  const showBack = view === 'add' || view === 'qr' || (view === 'signin' && accounts.length > 0);

  const activeColor = accounts.find((account) => account.isCurrent)?.color ?? null;
  const cardStyle = accentStyle(hoverColor ?? activeColor, isDark);

  const handleSelect = useCallback((account: SwitchableAccount) => {
    if (account.isCurrent) {
      onClose();
      return;
    }
    void controller.switchTo(account.accountId).then(() => {
      if (!controller.getSnapshot().error) onClose();
    });
  }, [controller, onClose]);

  const handleBack = useCallback(() => {
    if (view === 'qr') {
      controller.cancelSignIn();
    }
    controller.setView(accounts.length > 0 ? 'accounts' : 'signin');
    setHoverColor(null);
  }, [controller, view, accounts.length]);

  const signOutAll = useWebOxyOptional()?.signOutAll;

  // Move focus onto the intended PRIMARY element when the entry vs. list mode
  // swaps. Query the priority target individually (a comma-joined selector would
  // pick the first in DOM order — the header × button); fall back to any focusable.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const primary = isSignInEntry
      ? dialog.querySelector<HTMLElement>('.oxyad-primarybtn')
      : dialog.querySelector<HTMLElement>('.oxyad-row');
    (primary ?? dialog.querySelector<HTMLElement>(FOCUSABLE))?.focus();
  }, [isSignInEntry]);

  // Escape-to-close + a focus trap (Tab wrap). The focusable set is read live at
  // keydown time, so this listener never re-binds on view change.
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

  return (
    <div className="oxyad-root">
      <style>{DIALOG_CSS}</style>
      {/* Mouse-only click-outside close (kept out of the tab order; the header ×
          button is the keyboard-accessible close inside the focus trap). */}
      <button type="button" className="oxyad-backdrop" tabIndex={-1} aria-hidden="true" onClick={onClose} />
      <dialog ref={dialogRef} open aria-label="Accounts" className="oxyad-card" style={cardStyle}>
        {showBack ? (
          <button type="button" className="oxyad-back" aria-label="Back" onClick={handleBack}>‹</button>
        ) : null}
        <button type="button" className="oxyad-close" aria-label="Close" onClick={onClose}>×</button>
        {view === 'qr' ? (
          <QrView payload={signIn.qrPayload} error={signIn.error} />
        ) : isSignInEntry ? (
          <SignInEntryView
            onSignInWithOxy={() => { void controller.signInWithOxy(); }}
            onScanQr={() => { void controller.showQr(); }}
            onUsePassword={() => { controller.openPasswordAtOxyAuth(); }}
          />
        ) : (
          <AccountsView
            accounts={accounts}
            isDark={isDark}
            switchingAccountId={switchingAccountId}
            error={error}
            onSelect={handleSelect}
            onAdd={() => { controller.setView('signin'); setHoverColor(null); }}
            onHover={setHoverColor}
            onHoverEnd={() => setHoverColor(null)}
            onSignOutAll={signOutAll ? () => { void signOutAll(); onClose(); } : undefined}
          />
        )}
      </dialog>
    </div>
  );
}

/**
 * The unified account dialog. Rendered by {@link WebOxyProvider} out of the box
 * (opened by `signIn()` / `openAccountDialog()`); also exported so a consumer can
 * mount it directly over the provider's controller (or an explicit one).
 */
export function OxyAccountDialog({ open, onClose, controller: controllerProp }: OxyAccountDialogProps) {
  const contextController = useWebOxyOptional()?.accountDialog;
  const controller = controllerProp ?? contextController ?? null;
  if (!open || !controller) {
    return null;
  }
  return <OxyAccountDialogContent controller={controller} onClose={onClose} />;
}

// ---------------------------------------------------------------------------
// prefers-color-scheme (reactive, useSyncExternalStore — no effect-for-sync)
// ---------------------------------------------------------------------------

function subscribePrefersDark(callback: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined;
  }
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

function getPrefersDarkSnapshot(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function usePrefersDark(): boolean {
  return useSyncExternalStore(subscribePrefersDark, getPrefersDarkSnapshot, () => false);
}

export default OxyAccountDialog;
