import express from 'express';
import { SessionController } from '../controllers/session.controller';
import { User } from '../models/User';
import { rateLimit } from '../middleware/rateLimiter';

const router = express.Router();

// Auth routes that map to session controller methods
router.post('/signup', SessionController.register);
// Back-compat alias
router.post('/register', SessionController.register);
// Limit login attempts per IP to reduce brute-force
const loginLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 10 });
router.post('/login', loginLimiter, SessionController.signIn);
router.post('/totp/verify-login', SessionController.verifyTotpForLogin);

// Account recovery endpoints with tighter rate limits per IP+identifier
const recoverLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => `${req.ip}:${(req.body?.identifier || '').toString()}`,
});
router.post('/recover/request', recoverLimiter, SessionController.requestRecovery);
router.post('/recover/verify', recoverLimiter, SessionController.verifyRecoveryCode);
router.post('/recover/reset', recoverLimiter, SessionController.resetPassword);
router.post('/recover/totp/reset', recoverLimiter, SessionController.resetPasswordWithTotp);
router.post('/recover/backup/reset', recoverLimiter, SessionController.resetPasswordWithBackupCode);
router.post('/recover/recovery-key/reset', recoverLimiter, SessionController.resetPasswordWithRecoveryKey);

// TOTP enrollment (requires session via x-session-id)
router.post('/totp/enroll/start', SessionController.startTotpEnrollment);
router.post('/totp/enroll/verify', SessionController.verifyTotpEnrollment);
router.post('/totp/disable', SessionController.disableTotp);

// Auth validation endpoint
router.get('/validate', (req, res) => {
  // This endpoint is used by the frontend to validate auth status
  // It should check if the user is authenticated via the auth middleware
  res.json({ valid: true });
});

// Username and email availability check endpoints
router.get('/check-username/:username', async (req, res) => {
  try {
    let { username } = req.params;
    
    // Sanitize username: only allow alphanumeric characters
    username = username.replace(/[^a-zA-Z0-9]/g, '');
    
    if (!username || username.length < 3) {
      return res.status(400).json({ 
        available: false, 
        message: 'Username must be at least 3 characters long and contain only letters and numbers' 
      });
    }

    // Validate username format (alphanumeric only)
    if (!/^[a-zA-Z0-9]{3,30}$/.test(username)) {
      return res.status(400).json({ 
        available: false, 
        message: 'Username can only contain letters and numbers' 
      });
    }

    const existingUser = await User.findOne({ username });
    
    if (existingUser) {
      return res.json({ 
        available: false, 
        message: 'Username is already taken' 
      });
    }

    res.json({ 
      available: true, 
      message: 'Username is available' 
    });
  } catch (error) {
    res.status(500).json({ 
      available: false, 
      message: 'Error checking username availability' 
    });
  }
});

router.get('/check-email/:email', async (req, res) => {
  try {
    const { email } = req.params;
    
    if (!email || !email.includes('@')) {
      return res.status(400).json({ 
        available: false, 
        message: 'Please provide a valid email address' 
      });
    }

    const existingUser = await User.findOne({ email });
    
    if (existingUser) {
      return res.json({ 
        available: false, 
        message: 'Email is already registered' 
      });
    }

    res.json({ 
      available: true, 
      message: 'Email is available' 
    });
  } catch (error) {
    res.status(500).json({ 
      available: false, 
      message: 'Error checking email availability' 
    });
  }
});

export default router; 
 
