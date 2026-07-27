import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import type { CommonsApprovalInfo, PublicApplication } from '@oxyhq/core';
import { __resetOxyState } from '@/__mocks__/oxyhq-services';
import { LocaleProvider } from '@/lib/i18n/locale-context';
import { parseApprovalLink } from '@/lib/commons-signin/parse-approval-link';
import {
  ApprovalRequest,
  type ApprovalRequestProps,
} from '@/components/commons-signin/approval-request';

/** The application identity as the SERVER resolves it from the authorize code. */
const APPLICATION: PublicApplication = {
  id: 'app-1',
  name: 'Mention',
  icon: 'https://cloud.oxy.so/mention-logo.png',
  type: 'first_party',
  isOfficial: true,
  isInternal: false,
  scopes: ['profile:read'],
  developerName: 'Oxy',
  privacyPolicyUrl: 'https://mention.earth/privacy',
};

function makeInfo(overrides: Partial<CommonsApprovalInfo> = {}): CommonsApprovalInfo {
  return {
    application: APPLICATION,
    scopes: ['profile:read', 'email:read'],
    boundOrigin: 'https://mention.earth',
    originVerified: true,
    purpose: 'device_sign_in',
    subjectAccount: null,
    expiresAt: Date.now() + 300_000,
    status: 'pending',
    ...overrides,
  };
}

function renderRequest(overrides: Partial<ApprovalRequestProps> = {}) {
  const props: ApprovalRequestProps = {
    info: makeInfo(),
    application: APPLICATION,
    identityName: 'Nate',
    confirmationIssue: null,
    confirming: false,
    rejecting: false,
    onConfirm: jest.fn(),
    onReject: jest.fn(),
    onClose: jest.fn(),
    onOpenLink: jest.fn(),
    ...overrides,
  };
  return { props, ...render(<LocaleProvider><ApprovalRequest {...props} /></LocaleProvider>) };
}

/** Every tappable answer on the sheet, excluding the labelled close affordance. */
function answerActions(container: HTMLElement): (string | undefined)[] {
  return Array.from(container.querySelectorAll('button[role="button"]'))
    .filter((element) => !element.getAttribute('aria-label'))
    .map((element) => element.textContent?.trim());
}

describe('ApprovalRequest', () => {
  beforeEach(() => {
    __resetOxyState();
  });

  it('renders the request the SERVER resolved: app, origin and scopes', () => {
    const { container } = renderRequest();

    expect(container.textContent).toContain('Sign in to Mention');
    expect(container.textContent).toContain('mention.earth');
    // Scope sentences come from the shared consent dictionary.
    expect(container.textContent).toContain('Read your basic profile');
    expect(container.textContent).toContain('Read your email address');
    // The logo is the server-resolved record's, not a payload-supplied URL.
    expect(container.querySelector('img')?.getAttribute('src')).toBe(APPLICATION.icon);
  });

  it('offers ONE primary action and one alternative — no intermediate step', () => {
    const { container } = renderRequest();

    expect(answerActions(container)).toEqual(['Confirm identity', "This wasn't me"]);
  });

  it('invokes the confirmation directly from the primary action', () => {
    const { props, getByText } = renderRequest();

    fireEvent.click(getByText('Confirm identity'));

    // One press, one call — the press IS the biometric/passcode invocation
    // (the hook opens the device prompt); nothing else is triggered.
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
    expect(props.onReject).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('denies through "This wasn\'t me"', () => {
    const { props, getByText } = renderRequest();

    fireEvent.click(getByText("This wasn't me"));

    expect(props.onReject).toHaveBeenCalledTimes(1);
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it('treats dismissal as a cancel, never a denial', () => {
    const { props, getByLabelText } = renderRequest();

    fireEvent.click(getByLabelText('Close'));

    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onReject).not.toHaveBeenCalled();
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it('shows NO delegation chrome for an ordinary personal sign-in', () => {
    const { container, queryByTestId } = renderRequest();

    expect(queryByTestId('approval-delegation')).toBeNull();
    expect(container.textContent).not.toContain('Approving with');
    expect(container.textContent).not.toContain('will act as');
  });

  it('names both the approving identity and the delegated account when delegating', () => {
    const { container, getByTestId } = renderRequest({
      info: makeInfo({
        purpose: 'oauth_authorization',
        subjectAccount: {
          id: 'acct-9',
          username: 'oxycollective',
          displayName: 'The Oxy Collective',
        },
      }),
      identityName: 'Nate',
    });

    expect(getByTestId('approval-approving-with').textContent).toBe("Nate's Oxy identity");
    expect(getByTestId('approval-acting-as').textContent).toBe('The Oxy Collective');
    expect(container.textContent).toContain('Approving with');
    expect(container.textContent).toContain('Mention will act as');
  });

  it('never implies the identity became the organization', () => {
    const { container, getByTestId } = renderRequest({
      info: makeInfo({
        subjectAccount: { id: 'acct-9', username: 'oxycollective', displayName: 'The Oxy Collective' },
      }),
    });

    // The identity is stated as the approver, the account only as what the app
    // will act as — and it says so in words.
    expect(getByTestId('approval-approving-with').textContent).toContain('Nate');
    expect(getByTestId('approval-approving-with').textContent).not.toContain('Oxy Collective');
    expect(container.textContent).toContain("Your identity doesn't change");
  });

  it('falls back to the delegated account handle when it has no display name', () => {
    const { getByTestId } = renderRequest({
      info: makeInfo({ subjectAccount: { id: 'acct-9', username: 'oxycollective' } }),
    });

    expect(getByTestId('approval-acting-as').textContent).toBe('@oxycollective');
  });

  it('names the identity generically when the vault identity has no name yet', () => {
    const { getByTestId } = renderRequest({
      info: makeInfo({
        subjectAccount: { id: 'acct-9', username: 'oxycollective', displayName: 'The Oxy Collective' },
      }),
      identityName: null,
    });

    expect(getByTestId('approval-approving-with').textContent).toBe('Your Oxy identity');
  });

  it('renders NOTHING an untrusted payload asserted about itself', () => {
    // A phishing QR self-asserts an app name and an origin. The parser hands
    // back only the code, and the screen renders only what the server resolved.
    const parsed = parseApprovalLink(
      'oxycommons://approve?v=1&code=abc123&app=EvilCorp&origin=https%3A%2F%2Fevil.example&nonce=n1',
    );
    expect(parsed).toEqual({ ok: true, code: 'abc123' });

    const { container } = renderRequest();

    expect(container.textContent).not.toContain('EvilCorp');
    expect(container.textContent).not.toContain('evil.example');
    expect(container.textContent).toContain('Sign in to Mention');
    expect(container.textContent).toContain('mention.earth');
  });

  it('warns loudly when the request origin could not be verified', () => {
    const { container } = renderRequest({ info: makeInfo({ originVerified: false }) });

    expect(container.textContent).toContain("We couldn't verify this sign-in");
    // The reassuring "official app" treatment is withheld in this state.
    expect(container.textContent).not.toContain('Official Oxy app');
  });

  it('states the baseline the app receives when the request carries no scopes', () => {
    const { container } = renderRequest({ info: makeInfo({ scopes: [] }) });

    expect(container.textContent).toContain('Mention will receive');
    expect(container.textContent).toContain('Your identity, name, and profile picture');
  });

  it('shows an unknown scope verbatim instead of dropping it', () => {
    const { container } = renderRequest({ info: makeInfo({ scopes: ['ledger:write'] }) });

    expect(container.textContent).toContain('ledger:write');
  });

  it('explains a device that cannot confirm, and still approves nothing', () => {
    const { props, container } = renderRequest({
      confirmationIssue: { kind: 'unavailable', reason: 'no_enrollment' },
    });

    expect(container.textContent).toContain('no biometrics or screen lock');
    expect(container.textContent).toContain('device settings');
    // The explanation is not an approval, and it does not offer a way around
    // the gate — the same single action is still the only way forward.
    expect(props.onConfirm).not.toHaveBeenCalled();
    expect(answerActions(container)).toEqual(['Confirm identity', "This wasn't me"]);
  });

  it('distinguishes a cancelled prompt from a device that cannot ask', () => {
    const { container } = renderRequest({ confirmationIssue: { kind: 'declined' } });

    expect(container.textContent).toContain('Confirmation cancelled');
    expect(container.textContent).toContain('Nothing was approved');
  });

  it('explains a locked-out sensor', () => {
    const { container } = renderRequest({ confirmationIssue: { kind: 'lockout' } });

    expect(container.textContent).toContain('locked biometrics');
  });

  it('locks both answers while a confirmation is in flight', () => {
    const { container, getByText } = renderRequest({ confirming: true });

    expect((getByText("This wasn't me").closest('button') as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector('[role="progressbar"]')).not.toBeNull();
  });
});
