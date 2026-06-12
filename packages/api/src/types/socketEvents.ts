/**
 * Shared Socket.IO event payload types.
 *
 * Events are emitted to authenticated `user:${userId}` rooms set up by the
 * main Socket.IO connection handler in `server.ts`. Keep this file the single
 * source of truth so server emitters and client consumers stay in sync.
 */

/**
 * Emitted to `user:${userId}` when a new inbound email is delivered to one
 * of the user's mailboxes. Receiving clients should append the message to
 * their local feed and surface a notification badge.
 */
export interface EmailNewEvent {
  messageId: string;
  mailboxId: string;
  folder: string;
  from: { name?: string; address: string };
  subject: string;
  snippet: string;
  receivedAt: string;
  unread: true;
}

/**
 * Emitted to `user:${userId}` alongside `email:new` so unread badges can
 * update without a follow-up HTTP fetch.
 */
export interface EmailUnreadCountEvent {
  mailboxId: string;
  unread: number;
}
