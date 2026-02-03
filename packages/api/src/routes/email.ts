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
import {
  listMailboxes,
  createMailbox,
  deleteMailbox,
  listMessages,
  getMessage,
  updateMessageFlags,
  moveMessage,
  deleteMessage,
  sendMessage,
  saveDraft,
  searchMessages,
  getQuota,
  uploadAttachment,
  getAttachmentUrl,
  getEmailSettings,
  updateEmailSettings,
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
router.post('/mailboxes', asyncHandler(createMailbox));
router.delete('/mailboxes/:mailboxId', asyncHandler(deleteMailbox));

// ─── Messages ─────────────────────────────────────────────────────

router.get('/messages', asyncHandler(listMessages));
router.get('/messages/:messageId', asyncHandler(getMessage));
router.put('/messages/:messageId/flags', asyncHandler(updateMessageFlags));
router.post('/messages/:messageId/move', asyncHandler(moveMessage));
router.delete('/messages/:messageId', asyncHandler(deleteMessage));

// ─── Compose ──────────────────────────────────────────────────────

router.post('/messages', asyncHandler(sendMessage));
router.post('/drafts', asyncHandler(saveDraft));

// ─── Search ───────────────────────────────────────────────────────

router.get('/search', asyncHandler(searchMessages));

// ─── Quota ────────────────────────────────────────────────────────

router.get('/quota', asyncHandler(getQuota));

// ─── Attachments ──────────────────────────────────────────────────

router.post('/attachments', upload.single('file'), asyncHandler(uploadAttachment));
router.get('/attachments/:s3Key(*)', asyncHandler(getAttachmentUrl));

// ─── Settings ─────────────────────────────────────────────────────

router.get('/settings', asyncHandler(getEmailSettings));
router.put('/settings', asyncHandler(updateEmailSettings));

export default router;
