import express from 'express';
import { SessionController } from '../controllers/session.controller';
import { User } from '../models/User';

const router = express.Router();

// Auth routes that map to session controller methods
router.post('/signup', SessionController.register);
router.post('/login', SessionController.signIn);

// Auth validation endpoint
router.get('/validate', (req, res) => {
  // This endpoint is used by the frontend to validate auth status
  // It should check if the user is authenticated via the auth middleware
  res.json({ valid: true });
});

// Username and email availability check endpoints
router.get('/check-username/:username', async (req, res) => {
  try {
    const { username } = req.params;
    
    if (!username || username.length < 3) {
      return res.status(400).json({ 
        available: false, 
        message: 'Username must be at least 3 characters long' 
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