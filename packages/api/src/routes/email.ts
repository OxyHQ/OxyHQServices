/**
 * Email Routes
 *
 * RESTful API routes for the Oxy email system.
 * All routes require authentication via authMiddleware.
 */

import { Router } from 'express';
import multer from 'multer';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { validate } from '../middleware/validate';
import {
  createMailboxSchema,
  mailboxIdParams,
  messageIdParams,
  updateFlagsSchema,
  updateLabelsSchema,
  moveMessageSchema,
  snoozeMessageSchema,
  bulkUpdateFlagsSchema,
  bulkMoveMessagesSchema,
  createLabelSchema,
  labelIdParams,
  updateLabelSchema,
  sendMessageSchema,
  saveDraftSchema,
  unsubscribeSchema,
  bundleIdParams,
  updateBundleSchema,
  updateEmailSettingsSchema,
  createReminderSchema,
  reminderIdParams,
  updateReminderSchema,
} from '../schemas/email.schemas';
import {
  listMailboxes,
  createMailbox,
  deleteMailbox,
  listMessages,
  getMessage,
  getThread,
  updateMessageFlags,
  updateMessageLabels,
  moveMessage,
  deleteMessage,
  snoozeMessage,
  unsnoozeMessage,
  listLabels,
  createLabel,
  updateLabel,
  deleteLabel,
  sendMessage,
  saveDraft,
  searchMessages,
  getQuota,
  uploadAttachment,
  getAttachmentUrl,
  getEmailSettings,
  updateEmailSettings,
  listSubscriptions,
  unsubscribe,
  listBundles,
  updateBundle,
  listBundledMessages,
  bulkUpdateFlags,
  bulkMoveMessages,
  suggestContacts,
  createReminder,
  listReminders,
  getReminder,
  updateReminder,
  deleteReminder,
} from '../controllers/email.controller';

const router = Router();

// Multer for attachment uploads (in-memory, max 50 MB to allow for base64 overhead)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// All email routes require authentication
router.use(authMiddleware);

// ─── Mailboxes ────────────────────────────────────────────────────

router.get('/mailboxes', asyncHandler(listMailboxes));
router.post('/mailboxes', validate({ body: createMailboxSchema }), asyncHandler(createMailbox));
router.delete('/mailboxes/:mailboxId', validate({ params: mailboxIdParams }), asyncHandler(deleteMailbox));

// ─── Messages ─────────────────────────────────────────────────────

router.get('/messages', asyncHandler(listMessages));
router.get('/messages/bundled', asyncHandler(listBundledMessages));
router.get('/messages/:messageId', validate({ params: messageIdParams }), asyncHandler(getMessage));
router.get('/messages/:messageId/thread', validate({ params: messageIdParams }), asyncHandler(getThread));
router.put('/messages/:messageId/flags', validate({ params: messageIdParams, body: updateFlagsSchema }), asyncHandler(updateMessageFlags));
router.put('/messages/:messageId/labels', validate({ params: messageIdParams, body: updateLabelsSchema }), asyncHandler(updateMessageLabels));
router.post('/messages/:messageId/move', validate({ params: messageIdParams, body: moveMessageSchema }), asyncHandler(moveMessage));
router.delete('/messages/:messageId', validate({ params: messageIdParams }), asyncHandler(deleteMessage));
router.post('/messages/:messageId/snooze', validate({ params: messageIdParams, body: snoozeMessageSchema }), asyncHandler(snoozeMessage));
router.post('/messages/:messageId/unsnooze', validate({ params: messageIdParams }), asyncHandler(unsnoozeMessage));

// ─── Bulk Operations ─────────────────────────────────────────────

router.post('/messages/bulk/flags', validate({ body: bulkUpdateFlagsSchema }), asyncHandler(bulkUpdateFlags));
router.post('/messages/bulk/move', validate({ body: bulkMoveMessagesSchema }), asyncHandler(bulkMoveMessages));

// ─── Labels ──────────────────────────────────────────────────────

router.get('/labels', asyncHandler(listLabels));
router.post('/labels', validate({ body: createLabelSchema }), asyncHandler(createLabel));
router.put('/labels/:labelId', validate({ params: labelIdParams, body: updateLabelSchema }), asyncHandler(updateLabel));
router.delete('/labels/:labelId', validate({ params: labelIdParams }), asyncHandler(deleteLabel));

// ─── Contacts ────────────────────────────────────────────────────

router.get('/contacts/suggest', asyncHandler(suggestContacts));

// ─── Compose ──────────────────────────────────────────────────────

router.post('/messages', validate({ body: sendMessageSchema }), asyncHandler(sendMessage));
router.post('/drafts', validate({ body: saveDraftSchema }), asyncHandler(saveDraft));

// ─── Search ───────────────────────────────────────────────────────

router.get('/search', asyncHandler(searchMessages));

// ─── Quota ────────────────────────────────────────────────────────

router.get('/quota', asyncHandler(getQuota));

// ─── Attachments ──────────────────────────────────────────────────

router.post('/attachments', upload.single('file'), asyncHandler(uploadAttachment));
router.get('/attachments/:s3Key(*)', asyncHandler(getAttachmentUrl));

// ─── Subscriptions ───────────────────────────────────────────

router.get('/subscriptions', asyncHandler(listSubscriptions));
router.post('/subscriptions/unsubscribe', validate({ body: unsubscribeSchema }), asyncHandler(unsubscribe));

// ─── Bundles ──────────────────────────────────────────────────────

router.get('/bundles', asyncHandler(listBundles));
router.put('/bundles/:bundleId', validate({ params: bundleIdParams, body: updateBundleSchema }), asyncHandler(updateBundle));

// ─── Reminders ───────────────────────────────────────────────────

router.post('/reminders', validate({ body: createReminderSchema }), asyncHandler(createReminder));
router.get('/reminders', asyncHandler(listReminders));
router.get('/reminders/:reminderId', validate({ params: reminderIdParams }), asyncHandler(getReminder));
router.put('/reminders/:reminderId', validate({ params: reminderIdParams, body: updateReminderSchema }), asyncHandler(updateReminder));
router.delete('/reminders/:reminderId', validate({ params: reminderIdParams }), asyncHandler(deleteReminder));

// ─── Settings ─────────────────────────────────────────────────────

router.get('/settings', asyncHandler(getEmailSettings));
router.put('/settings', validate({ body: updateEmailSettingsSchema }), asyncHandler(updateEmailSettings));

export default router;
