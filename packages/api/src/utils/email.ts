import type { Transporter } from 'nodemailer';
import nodemailer from 'nodemailer';

export interface EmailPayload {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  from?: string;
}

let cachedTransporter: Transporter | null = null;

function boolFromEnv(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function getDefaultFrom(): string {
  return process.env.SMTP_FROM || 'Oxy <no-reply@oxy.local>';
}

async function getTransporter(): Promise<Transporter | null> {
  const mode = (process.env.EMAIL_PROVIDER || process.env.EMAIL_MODE || 'smtp').toLowerCase();

  if (mode === 'console') {
    return null; // console mode means no real transport
  }

  if (cachedTransporter) return cachedTransporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = boolFromEnv(process.env.SMTP_SECURE, port === 465);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    // eslint-disable-next-line no-console
    console.warn('[Email] SMTP not fully configured (SMTP_HOST/SMTP_USER/SMTP_PASS). Falling back to console mode.');
    return null;
  }

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  // Verify once (non-blocking)
  try {
    await cachedTransporter.verify();
    // eslint-disable-next-line no-console
    console.log('[Email] SMTP transporter verified.');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[Email] SMTP transporter verification failed:', e);
  }

  return cachedTransporter;
}

export async function sendEmail({ to, subject, text, html, from }: EmailPayload): Promise<void> {
  const transporter = await getTransporter();

  if (!transporter) {
    // Console fallback
    // eslint-disable-next-line no-console
    console.log('[Email:console] To:', to, '\nSubject:', subject, '\nText:', text, '\nHTML:', html ? '[provided]' : '[none]');
    return;
  }

  const mailOptions = {
    from: from || getDefaultFrom(),
    to,
    subject,
    text: text || (html ? undefined : ''),
    html,
  };

  await transporter.sendMail(mailOptions);
}

export async function sendRecoveryEmail(to: string, code: string, expiresMinutes = 15): Promise<void> {
  const subject = 'Your Oxy Account Recovery Code';
  const text = `Your account recovery code is: ${code}\n\nThis code expires in ${expiresMinutes} minutes.`;
  const html = `<p>Your account recovery code is:</p><h2>${code}</h2><p>This code expires in <strong>${expiresMinutes}</strong> minutes.</p>`;
  await sendEmail({ to, subject, text, html });
}
