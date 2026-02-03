/**
 * Email API client
 *
 * Wraps the Oxy email REST API for use in the Inbox app.
 * Uses OxyServices from @oxyhq/core under the hood.
 */

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.oxy.so';

export interface EmailAddress {
  name?: string;
  address: string;
}

export interface Attachment {
  filename: string;
  contentType: string;
  size: number;
  s3Key: string;
}

export interface MessageFlags {
  seen: boolean;
  starred: boolean;
  answered: boolean;
  forwarded: boolean;
  draft: boolean;
}

export interface Message {
  _id: string;
  userId: string;
  mailboxId: string;
  messageId: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  subject: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
  attachments: Attachment[];
  flags: MessageFlags;
  labels: string[];
  spamScore?: number;
  size: number;
  inReplyTo?: string;
  references?: string[];
  aliasTag?: string;
  date: string;
  receivedAt: string;
}

export interface Mailbox {
  _id: string;
  userId: string;
  name: string;
  path: string;
  specialUse?: string;
  totalMessages: number;
  unseenMessages: number;
  size: number;
}

export interface Pagination {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface QuotaUsage {
  used: number;
  limit: number;
  percentage: number;
  dailySendCount: number;
  dailySendLimit: number;
}

export interface EmailSettings {
  signature: string;
  autoReply: {
    enabled: boolean;
    subject: string;
    body: string;
    startDate: string | null;
    endDate: string | null;
  };
}

class EmailApi {
  private getHeaders(token: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
  }

  private async request<T>(
    path: string,
    token: string,
    options: RequestInit = {},
  ): Promise<T> {
    const res = await fetch(`${API_URL}/api/email${path}`, {
      ...options,
      headers: {
        ...this.getHeaders(token),
        ...(options.headers || {}),
      },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `Request failed: ${res.status}`);
    }

    const json = await res.json();
    return json.data;
  }

  // ─── Mailboxes ──────────────────────────────────────────────────

  async listMailboxes(token: string): Promise<Mailbox[]> {
    return this.request<Mailbox[]>('/mailboxes', token);
  }

  async createMailbox(
    token: string,
    name: string,
    parentPath?: string,
  ): Promise<Mailbox> {
    return this.request<Mailbox>('/mailboxes', token, {
      method: 'POST',
      body: JSON.stringify({ name, parentPath }),
    });
  }

  async deleteMailbox(token: string, mailboxId: string): Promise<void> {
    await this.request(`/mailboxes/${mailboxId}`, token, { method: 'DELETE' });
  }

  // ─── Messages ───────────────────────────────────────────────────

  async listMessages(
    token: string,
    mailboxId: string,
    options: { limit?: number; offset?: number; unseenOnly?: boolean } = {},
  ): Promise<{ data: Message[]; pagination: Pagination }> {
    const params = new URLSearchParams({ mailbox: mailboxId });
    if (options.limit) params.set('limit', String(options.limit));
    if (options.offset) params.set('offset', String(options.offset));
    if (options.unseenOnly) params.set('unseen', 'true');

    const res = await fetch(`${API_URL}/api/email/messages?${params}`, {
      headers: this.getHeaders(token),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `Request failed: ${res.status}`);
    }

    return res.json();
  }

  async getMessage(token: string, messageId: string): Promise<Message> {
    return this.request<Message>(`/messages/${messageId}`, token);
  }

  async updateFlags(
    token: string,
    messageId: string,
    flags: Partial<MessageFlags>,
  ): Promise<Message> {
    return this.request<Message>(`/messages/${messageId}/flags`, token, {
      method: 'PUT',
      body: JSON.stringify({ flags }),
    });
  }

  async moveMessage(
    token: string,
    messageId: string,
    mailboxId: string,
  ): Promise<Message> {
    return this.request<Message>(`/messages/${messageId}/move`, token, {
      method: 'POST',
      body: JSON.stringify({ mailboxId }),
    });
  }

  async deleteMessage(
    token: string,
    messageId: string,
    permanent = false,
  ): Promise<void> {
    const params = permanent ? '?permanent=true' : '';
    await this.request(`/messages/${messageId}${params}`, token, {
      method: 'DELETE',
    });
  }

  // ─── Compose ────────────────────────────────────────────────────

  async sendMessage(
    token: string,
    message: {
      to: EmailAddress[];
      cc?: EmailAddress[];
      bcc?: EmailAddress[];
      subject: string;
      text?: string;
      html?: string;
      inReplyTo?: string;
      references?: string[];
      attachments?: string[];
    },
  ): Promise<{ messageId: string; queued: boolean; message: string }> {
    return this.request('/messages', token, {
      method: 'POST',
      body: JSON.stringify(message),
    });
  }

  async saveDraft(
    token: string,
    draft: {
      to?: EmailAddress[];
      cc?: EmailAddress[];
      bcc?: EmailAddress[];
      subject?: string;
      text?: string;
      html?: string;
      inReplyTo?: string;
      references?: string[];
      existingDraftId?: string;
    },
  ): Promise<Message> {
    return this.request<Message>('/drafts', token, {
      method: 'POST',
      body: JSON.stringify(draft),
    });
  }

  // ─── Search ─────────────────────────────────────────────────────

  async search(
    token: string,
    query: string,
    options: { limit?: number; offset?: number; mailbox?: string } = {},
  ): Promise<{ data: Message[]; pagination: Pagination }> {
    const params = new URLSearchParams({ q: query });
    if (options.limit) params.set('limit', String(options.limit));
    if (options.offset) params.set('offset', String(options.offset));
    if (options.mailbox) params.set('mailbox', options.mailbox);

    const res = await fetch(`${API_URL}/api/email/search?${params}`, {
      headers: this.getHeaders(token),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `Request failed: ${res.status}`);
    }

    return res.json();
  }

  // ─── Quota ──────────────────────────────────────────────────────

  async getQuota(token: string): Promise<QuotaUsage> {
    return this.request<QuotaUsage>('/quota', token);
  }

  // ─── Attachments ────────────────────────────────────────────────

  async getAttachmentUrl(token: string, s3Key: string): Promise<string> {
    const result = await this.request<{ url: string }>(
      `/attachments/${encodeURIComponent(s3Key)}`,
      token,
    );
    return result.url;
  }

  // ─── Settings ───────────────────────────────────────────────────

  async getSettings(token: string): Promise<EmailSettings> {
    return this.request<EmailSettings>('/settings', token);
  }

  async updateSettings(
    token: string,
    settings: { signature?: string; autoReply?: Partial<EmailSettings['autoReply']> },
  ): Promise<void> {
    await this.request('/settings', token, {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  }
}

export const emailApi = new EmailApi();
