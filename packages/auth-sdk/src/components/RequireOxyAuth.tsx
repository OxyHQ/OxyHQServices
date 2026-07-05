/**
 * RequireOxyAuth — the optional signed-out gate primitive (web).
 *
 * The web counterpart of `@oxyhq/services`' `RequireOxyAuth`, with the SAME prop
 * contract. ONE shared way for any RP web app to opt into a signed-out gate:
 *  - `prompt="off"`  — render children unconditionally (public app; a no-op).
 *  - `prompt="soft"` — render children plus a dismissible sign-in banner while
 *    signed out.
 *  - `prompt="hard"` — block children behind a centered signed-out state until
 *    the user signs in.
 *
 * Every mode reuses the ONE account dialog `WebOxyProvider` already mounts —
 * opening the sign-in surface is always `openAccountDialog('signin')`; there is
 * NO second dialog.
 *
 * Readiness gating (CRITICAL): keys on the provider's own readiness state
 * (`canUsePrivateApi` / `isPrivateApiPending`), NEVER app-local hooks. While the
 * device-first cold boot is still resolving it renders a neutral loading state so
 * the signed-out wall never flashes before auth resolves.
 *
 * Dependency-free by design (no CSS framework, no `react-dom` portal): a scoped
 * `<style>` block carries the look so `@oxyhq/auth` stays bloom-free / RN-free,
 * exactly like the sibling `OxyAccountDialog`.
 */

import type { ReactNode } from 'react';
import { useState } from 'react';
import { useWebOxy } from '../WebOxyProvider';

/**
 * How `RequireOxyAuth` treats a signed-out (or still-resolving) session.
 *  - `off`  — always render children (public app; a no-op provided for symmetry).
 *  - `soft` — render children, plus a dismissible sign-in banner when signed out.
 *  - `hard` — block children behind a centered signed-out state until signed in.
 */
export type RequireOxyAuthPrompt = 'off' | 'soft' | 'hard';

export interface RequireOxyAuthProps {
  children: ReactNode;
  /** Gate behavior. @default 'hard' */
  prompt?: RequireOxyAuthPrompt;
  /** Replaces the neutral loading UI shown while auth is still resolving. */
  loadingFallback?: ReactNode;
  /** Replaces the entire default signed-out wall (`prompt="hard"`). */
  signedOutFallback?: ReactNode;
  /** Title for the default `prompt="hard"` wall. */
  title?: string;
  /** Subtitle for the default `prompt="hard"` wall. */
  subtitle?: string;
  /** Message for the `prompt="soft"` banner. */
  bannerMessage?: string;
  /** CTA label for the `prompt="soft"` banner. */
  bannerActionLabel?: string;
}

const DEFAULT_TITLE = 'Sign in to continue';
const DEFAULT_SUBTITLE = 'Sign in with your Oxy account to continue.';
const DEFAULT_BANNER_MESSAGE = "You're browsing signed out.";
const DEFAULT_BANNER_ACTION = 'Sign in';

const GATE_CSS = `
.oxygate-root{
  --oxygate-bg:hsl(270 30% 98.5%);
  --oxygate-fg:hsl(268 28% 12%);
  --oxygate-muted:hsl(268 10% 46%);
  --oxygate-border:hsl(268 24% 88%);
  --oxygate-primary:hsl(277 66% 56%);
  --oxygate-primary-hover:hsl(277 66% 48%);
  --oxygate-soft:hsl(277 66% 96%);
  --oxygate-on-primary:hsl(0 0% 100%);
  min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;
  padding:32px 24px;text-align:center;box-sizing:border-box;
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--oxygate-fg);
}
.oxygate-full{position:fixed;inset:0;background:var(--oxygate-bg);z-index:2147482000;}
.oxygate-logo{width:80px;height:80px;border-radius:22px;display:flex;align-items:center;justify-content:center;
  background:var(--oxygate-primary);color:var(--oxygate-on-primary);font-weight:800;font-size:34px;
  box-shadow:0 12px 30px hsl(277 66% 56% / 0.32);}
.oxygate-title{font-size:22px;font-weight:800;margin:8px 0 0;letter-spacing:-.02em;}
.oxygate-sub{font-size:14px;color:var(--oxygate-muted);margin:0;max-width:22rem;line-height:1.4;}
.oxygate-btn{margin-top:8px;padding:12px 28px;border:none;border-radius:14px;background:var(--oxygate-primary);
  color:var(--oxygate-on-primary);font-size:15px;font-weight:700;cursor:pointer;
  box-shadow:0 8px 20px hsl(277 66% 56% / 0.32);transition:background .14s,transform .1s;}
.oxygate-btn:hover{background:var(--oxygate-primary-hover);}
.oxygate-btn:active{transform:scale(.985);}
.oxygate-spinner{width:26px;height:26px;border-radius:50%;border:3px solid var(--oxygate-border);
  border-top-color:var(--oxygate-primary);animation:oxygate-spin .7s linear infinite;}
@keyframes oxygate-spin{to{transform:rotate(360deg)}}
.oxygate-softwrap{display:flex;flex-direction:column;min-height:0;}
.oxygate-banner{display:flex;align-items:center;gap:12px;padding:10px 16px;box-sizing:border-box;
  background:var(--oxygate-soft);border-bottom:1px solid var(--oxygate-border);color:var(--oxygate-fg);
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
.oxygate-bannertext{flex:1;font-size:13.5px;}
.oxygate-bannerbtn{padding:6px 16px;border:none;border-radius:999px;background:var(--oxygate-primary);
  color:var(--oxygate-on-primary);font-size:13px;font-weight:700;cursor:pointer;}
.oxygate-bannerbtn:hover{background:var(--oxygate-primary-hover);}
.oxygate-bannerx{background:none;border:none;color:var(--oxygate-muted);font-size:16px;line-height:1;cursor:pointer;padding:4px 6px;}
.oxygate-bannerx:hover{color:var(--oxygate-primary-hover);}
@media (prefers-color-scheme: dark){
  .oxygate-root{
    --oxygate-bg:hsl(268 20% 12.5%);
    --oxygate-fg:hsl(266 30% 95%);
    --oxygate-muted:hsl(266 12% 62%);
    --oxygate-border:hsl(268 18% 24%);
    --oxygate-primary:hsl(277 72% 68%);
    --oxygate-primary-hover:hsl(277 74% 74%);
    --oxygate-soft:hsl(277 32% 20%);
  }
}
`;

/**
 * Optional signed-out gate. Wrap any subtree (or the whole app via
 * `WebOxyProvider`'s `requireAuth` prop) to opt into a shared, readiness-safe
 * wall. Must render inside a {@link WebOxyProvider}.
 */
export function RequireOxyAuth({
  children,
  prompt = 'hard',
  loadingFallback,
  signedOutFallback,
  title,
  subtitle,
  bannerMessage,
  bannerActionLabel,
}: RequireOxyAuthProps) {
  const { canUsePrivateApi, isPrivateApiPending, openAccountDialog } = useWebOxy();

  // Public app: render straight through.
  if (prompt === 'off') {
    return <>{children}</>;
  }

  // Signed in (and token ready): render the protected subtree in every mode.
  if (canUsePrivateApi) {
    return <>{children}</>;
  }

  if (prompt === 'soft') {
    return (
      <SoftGate
        pending={isPrivateApiPending}
        message={bannerMessage ?? DEFAULT_BANNER_MESSAGE}
        actionLabel={bannerActionLabel ?? DEFAULT_BANNER_ACTION}
        onSignIn={() => openAccountDialog('signin')}
      >
        {children}
      </SoftGate>
    );
  }

  // prompt === 'hard'
  if (isPrivateApiPending) {
    return loadingFallback ? <>{loadingFallback}</> : <NeutralLoading />;
  }
  if (signedOutFallback) {
    return <>{signedOutFallback}</>;
  }
  return (
    <HardWall
      title={title ?? DEFAULT_TITLE}
      subtitle={subtitle ?? DEFAULT_SUBTITLE}
      onSignIn={() => openAccountDialog('signin')}
    />
  );
}

function SoftGate({
  children,
  pending,
  message,
  actionLabel,
  onSignIn,
}: {
  children: ReactNode;
  pending: boolean;
  message: string;
  actionLabel: string;
  onSignIn: () => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  const showBanner = !pending && !dismissed;
  return (
    <div className="oxygate-softwrap">
      <style>{GATE_CSS}</style>
      {showBanner ? (
        <div className="oxygate-banner">
          <span className="oxygate-bannertext">{message}</span>
          <button type="button" className="oxygate-bannerbtn" onClick={onSignIn}>
            {actionLabel}
          </button>
          <button type="button" className="oxygate-bannerx" aria-label="Dismiss" onClick={() => setDismissed(true)}>
            ✕
          </button>
        </div>
      ) : null}
      {children}
    </div>
  );
}

function HardWall({ title, subtitle, onSignIn }: { title: string; subtitle: string; onSignIn: () => void }) {
  return (
    <div className="oxygate-root oxygate-full">
      <style>{GATE_CSS}</style>
      <span className="oxygate-logo" aria-hidden="true">O</span>
      <h1 className="oxygate-title">{title}</h1>
      <p className="oxygate-sub">{subtitle}</p>
      <button type="button" className="oxygate-btn" onClick={onSignIn}>
        Sign in with Oxy
      </button>
    </div>
  );
}

function NeutralLoading() {
  return (
    <div className="oxygate-root oxygate-full">
      <style>{GATE_CSS}</style>
      <span className="oxygate-spinner" role="status" aria-label="Loading" />
    </div>
  );
}

export default RequireOxyAuth;
