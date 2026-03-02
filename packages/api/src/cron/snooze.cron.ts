/**
 * Snooze & reminder processor — checks for snoozed messages and due reminders.
 * Runs every 60 seconds via setInterval (no external dependency needed).
 */

import { emailService } from '../services/email.service';
import { logger } from '../utils/logger';

const INTERVAL_MS = 60_000; // 1 minute

let timer: ReturnType<typeof setInterval> | null = null;

export function startSnoozeCron(): void {
  if (timer) return; // Already running

  timer = setInterval(async () => {
    try {
      await emailService.processSnoozedMessages();
    } catch (err) {
      logger.error('Snooze cron failed', err instanceof Error ? err : new Error(String(err)));
    }
    try {
      await emailService.processDueReminders();
    } catch (err) {
      logger.error('Reminder cron failed', err instanceof Error ? err : new Error(String(err)));
    }
  }, INTERVAL_MS);

  logger.info('Snooze & reminder cron started (60s interval)');
}

export function stopSnoozeCron(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
