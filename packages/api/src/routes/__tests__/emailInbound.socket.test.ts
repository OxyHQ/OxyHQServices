/**
 * Inbound email Socket.IO emit tests.
 *
 * Exercises the real `/email/inbound` route handler with the mongoose models,
 * the email service, the spam service, and the Socket.IO singleton all
 * stubbed at the module boundary. The assertions cover:
 *
 *  1. Successful delivery emits `email:new` to the recipient's `user:<id>`
 *     room with the contracted `EmailNewEvent` payload shape.
 *  2. The same delivery emits `email:unread_count` with the post-insert
 *     unread total for the destination mailbox.
 *  3. When `getIO()` returns null (Socket.IO not initialised), the webhook
 *     still responds 200 — failure isolation contract for the Cloudflare
 *     worker upstream.
 */

import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

const TEST_WEBHOOK_SECRET = 'test-inbound-secret';
process.env.EMAIL_INBOUND_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;

const mockGetIO = jest.fn();
const mockStoreIncomingMessage = jest.fn();
const mockSpamCheck = jest.fn();
const mockSpamShouldReject = jest.fn();
const mockUserFindOne = jest.fn();
const mockMailboxFindById = jest.fn();
const mockMessageCountDocuments = jest.fn();
const mockLoggerWarn = jest.fn();
const mockLoggerInfo = jest.fn();
const mockLoggerError = jest.fn();

jest.mock('../../utils/socket', () => ({
  getIO: (...args: unknown[]) => mockGetIO(...args),
}));

jest.mock('../../services/email.service', () => ({
  emailService: {
    storeIncomingMessage: (...args: unknown[]) => mockStoreIncomingMessage(...args),
  },
}));

jest.mock('../../services/spam.service', () => ({
  spamService: {
    check: (...args: unknown[]) => mockSpamCheck(...args),
    shouldReject: (...args: unknown[]) => mockSpamShouldReject(...args),
  },
}));

jest.mock('../../models/User', () => ({
  __esModule: true,
  default: { findOne: (...args: unknown[]) => mockUserFindOne(...args) },
}));

jest.mock('../../models/Mailbox', () => ({
  Mailbox: { findById: (...args: unknown[]) => mockMailboxFindById(...args) },
}));

jest.mock('../../models/Message', () => ({
  Message: { countDocuments: (...args: unknown[]) => mockMessageCountDocuments(...args) },
}));

jest.mock('../../utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    error: (...args: unknown[]) => mockLoggerError(...args),
  },
}));

jest.mock('../../middleware/rateLimiter', () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import emailInboundRouter from '../emailInbound';
import { errorHandler } from '../../middleware/errorHandler';

interface RawResponse {
  status: number;
  body: { error?: string; accepted?: number; rejected?: number };
}

function postRaw(server: http.Server, path: string, headers: Record<string, string>, body: Buffer): Promise<RawResponse> {
  const address = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: 'POST',
        host: '127.0.0.1',
        port: address.port,
        path,
        headers: {
          'content-type': 'message/rfc822',
          'content-length': body.length,
          ...headers,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          try {
            const parsed = raw.length > 0 ? JSON.parse(raw) : {};
            resolve({ status: res.statusCode ?? 0, body: parsed });
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

let server: http.Server;

beforeAll((done) => {
  const app = express();
  app.use('/email/inbound', express.raw({ type: '*/*', limit: '25mb' }));
  app.use('/email/inbound', emailInboundRouter);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1', done);
});

afterAll((done) => {
  server.close(done);
});

const RAW_MESSAGE = Buffer.from(
  [
    'From: "Alice Sender" <alice@example.com>',
    'To: bob@oxy.so',
    'Subject: Hello there',
    'Date: Mon, 1 Jan 2024 00:00:00 +0000',
    'Message-ID: <test-msg-1@example.com>',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'This is a   plain text body that should become the snippet.',
    '',
  ].join('\r\n'),
  'utf8'
);

const RECIPIENT_USER_ID = '64b0000000000000000000aa';
const MAILBOX_ID = '64b0000000000000000000bb';
const MESSAGE_ID = '64b0000000000000000000cc';

function stageRecipient(userId: string): void {
  mockUserFindOne.mockReturnValueOnce({
    select: () => ({
      lean: () => Promise.resolve({ _id: { toString: () => userId } }),
    }),
  });
}

function stageMailbox(mailboxId: string, specialUse: string, name: string): void {
  mockMailboxFindById.mockReturnValueOnce({
    select: () => ({
      lean: () => Promise.resolve({ _id: mailboxId, specialUse, name }),
    }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSpamCheck.mockResolvedValue({ score: 0, action: 'no action' });
  mockSpamShouldReject.mockReturnValue(false);
});

describe('POST /email/inbound socket emit', () => {
  it('emits email:new and email:unread_count to the recipient user room', async () => {
    stageRecipient(RECIPIENT_USER_ID);
    stageMailbox(MAILBOX_ID, '\\Inbox', 'INBOX');

    mockStoreIncomingMessage.mockResolvedValueOnce({
      id: MESSAGE_ID,
      mailboxId: { toString: () => MAILBOX_ID },
      receivedAt: new Date('2024-01-01T00:00:00.000Z'),
    });
    mockMessageCountDocuments.mockResolvedValueOnce(7);

    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    mockGetIO.mockReturnValue({ to });

    const res = await postRaw(
      server,
      '/email/inbound',
      {
        authorization: `Bearer ${TEST_WEBHOOK_SECRET}`,
        'x-envelope-from': 'alice@example.com',
        'x-envelope-to': 'bob@oxy.so',
      },
      RAW_MESSAGE
    );

    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(1);
    expect(mockStoreIncomingMessage).toHaveBeenCalledTimes(1);

    expect(to).toHaveBeenCalledWith(`user:${RECIPIENT_USER_ID}`);

    const emailNewCall = emit.mock.calls.find(([event]) => event === 'email:new');
    expect(emailNewCall).toBeDefined();
    const emailNewPayload = emailNewCall?.[1] as Record<string, unknown>;
    expect(emailNewPayload).toEqual(
      expect.objectContaining({
        messageId: MESSAGE_ID,
        mailboxId: MAILBOX_ID,
        folder: 'inbox',
        from: { name: 'Alice Sender', address: 'alice@example.com' },
        subject: 'Hello there',
        receivedAt: '2024-01-01T00:00:00.000Z',
        unread: true,
      })
    );
    expect(typeof emailNewPayload.snippet).toBe('string');
    expect((emailNewPayload.snippet as string).length).toBeGreaterThan(0);
    expect((emailNewPayload.snippet as string).length).toBeLessThanOrEqual(140);
    expect(emailNewPayload.snippet).toBe('This is a plain text body that should become the snippet.');

    const unreadCall = emit.mock.calls.find(([event]) => event === 'email:unread_count');
    expect(unreadCall).toBeDefined();
    expect(unreadCall?.[1]).toEqual({ mailboxId: MAILBOX_ID, unread: 7 });
  });

  it('still returns 200 when Socket.IO is unavailable (failure isolation)', async () => {
    stageRecipient(RECIPIENT_USER_ID);

    mockStoreIncomingMessage.mockResolvedValueOnce({
      id: MESSAGE_ID,
      mailboxId: { toString: () => MAILBOX_ID },
      receivedAt: new Date('2024-01-01T00:00:00.000Z'),
    });
    mockGetIO.mockReturnValue(null);

    const res = await postRaw(
      server,
      '/email/inbound',
      {
        authorization: `Bearer ${TEST_WEBHOOK_SECRET}`,
        'x-envelope-from': 'alice@example.com',
        'x-envelope-to': 'bob@oxy.so',
      },
      RAW_MESSAGE
    );

    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(1);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('Socket.IO not initialised')
    );
  });
});
