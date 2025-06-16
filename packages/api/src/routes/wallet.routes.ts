import express from 'express';
import {
  getWallet,
  getTransactionHistory,
  transferFunds,
  processPurchase,
  requestWithdrawal,
  getTransaction
} from '../controllers/wallet.controller';
import { authMiddleware } from '../middleware/auth';

const router = express.Router();

// All wallet routes require authentication
router.use(authMiddleware);

// Wallet info routes
router.get('/:userId', getWallet);
router.get('/transactions/:userId', getTransactionHistory);
router.get('/transaction/:transactionId', getTransaction);

// Transaction routes
router.post('/transfer', transferFunds);
router.post('/purchase', processPurchase);
router.post('/withdraw', requestWithdrawal);

export default router; 