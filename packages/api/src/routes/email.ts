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
  createFilterSchema,
  filterIdParams,
  updateFilterSchema,
  createTemplateSchema,
  templateIdParams,
  updateTemplateSchema,
  createContactSchema,
  contactIdParams,
  updateContactSchema,
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
  listContacts,
  createContact,
  updateContact,
  deleteContact,
  createReminder,
  listReminders,
  getReminder,
  updateReminder,
  deleteReminder,
  listFilters,
  createFilter,
  updateFilter,
  deleteFilter,
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  exportMessage,
  importMessages,
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
router.get('/messages/:messageId/export', validate({ params: messageIdParams }), asyncHandler(exportMessage));
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
router.get('/contacts', asyncHandler(listContacts));
router.post('/contacts', validate({ body: createContactSchema }), asyncHandler(createContact));
router.put('/contacts/:contactId', validate({ params: contactIdParams, body: updateContactSchema }), asyncHandler(updateContact));
router.delete('/contacts/:contactId', validate({ params: contactIdParams }), asyncHandler(deleteContact));

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

// ─── Import ───────────────────────────────────────────────────────

router.post('/import', upload.array('files', 50), asyncHandler(importMessages));

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

// ─── Filters ────────────────────────────────────────────────────

router.get('/filters', asyncHandler(listFilters));
router.post('/filters', validate({ body: createFilterSchema }), asyncHandler(createFilter));
router.put('/filters/:filterId', validate({ params: filterIdParams, body: updateFilterSchema }), asyncHandler(updateFilter));
router.delete('/filters/:filterId', validate({ params: filterIdParams }), asyncHandler(deleteFilter));

// ─── Templates ──────────────────────────────────────────────────

router.get('/templates', asyncHandler(listTemplates));
router.post('/templates', validate({ body: createTemplateSchema }), asyncHandler(createTemplate));
router.put('/templates/:templateId', validate({ params: templateIdParams, body: updateTemplateSchema }), asyncHandler(updateTemplate));
router.delete('/templates/:templateId', validate({ params: templateIdParams }), asyncHandler(deleteTemplate));

// ─── Settings ─────────────────────────────────────────────────────

router.get('/settings', asyncHandler(getEmailSettings));
router.put('/settings', validate({ body: updateEmailSettingsSchema }), asyncHandler(updateEmailSettings));

export default router;
