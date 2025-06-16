import express, { Request, Response } from "express";
import Session, { ISession } from "../models/Session";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { logger } from "../utils/logger";
import { createSession, updateSessionActivity } from "../utils/sessionUtils";
import crypto from "crypto";

const router = express.Router();

// Get all active sessions for the current user
router.get("/", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id || req.user?._id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated"
      });
    }

    const sessions = await Session.find({
      userId,
      isActive: true,
      expiresAt: { $gt: new Date() }
    }).sort({ "deviceInfo.lastActive": -1 });

    const formattedSessions = sessions.map(session => ({
      id: session._id,
      deviceInfo: {
        deviceType: session.deviceInfo?.deviceType || 'Unknown',
        platform: session.deviceInfo?.platform || 'Unknown',
        browser: session.deviceInfo?.browser || 'Unknown',
        os: session.deviceInfo?.os || 'Unknown',
        lastActive: session.deviceInfo?.lastActive || session.createdAt,
        ipAddress: session.deviceInfo?.ipAddress || 'Unknown'
      },
      createdAt: session.createdAt,
      isCurrent: false // Will be determined on frontend
    }));

    res.json({
      success: true,
      sessions: formattedSessions
    });
  } catch (error) {
    logger.error("Error fetching user sessions:", error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: "Failed to fetch sessions"
      });
    }
  }
});

// Remote logout from a specific session
router.delete("/:sessionId", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user?.id || req.user?._id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated"
      });
    }

    const session = await Session.findOne({
      _id: sessionId,
      userId,
      isActive: true
    });

    if (!session) {
      return res.status(404).json({
        success: false,
        message: "Session not found"
      });
    }

    // Deactivate the session
    session.isActive = false;
    await session.save();

    logger.info(`Session ${sessionId} deactivated by user ${userId}`);

    res.json({
      success: true,
      message: "Session terminated successfully"
    });
  } catch (error) {
    logger.error("Error terminating session:", error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: "Failed to terminate session"
      });
    }
  }
});

// Logout from all other sessions (keep current session active)
router.post("/logout-others", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const currentToken = req.headers.authorization?.split(' ')[1];

    if (!userId || !currentToken) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated"
      });
    }

    // Find current session to keep it active
    const currentSession = await Session.findOne({
      userId,
      token: currentToken,
      isActive: true
    });

    if (!currentSession) {
      return res.status(404).json({
        success: false,
        message: "Current session not found"
      });
    }

    // Deactivate all other sessions
    const result = await Session.updateMany(
      {
        userId,
        _id: { $ne: currentSession._id },
        isActive: true
      },
      {
        $set: { isActive: false }
      }
    );

    logger.info(`User ${userId} logged out from ${result.modifiedCount} other sessions`);

    res.json({
      success: true,
      message: `Logged out from ${result.modifiedCount} other sessions`,
      sessionsTerminated: result.modifiedCount
    });
  } catch (error) {
    logger.error("Error logging out from other sessions:", error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: "Failed to logout from other sessions"
      });
    }
  }
});

// Logout from all sessions (including current)
router.post("/logout-all", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id || req.user?._id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated"
      });
    }

    // Deactivate all sessions for this user
    const result = await Session.updateMany(
      {
        userId,
        isActive: true
      },
      {
        $set: { isActive: false }
      }
    );

    logger.info(`User ${userId} logged out from all ${result.modifiedCount} sessions`);

    res.json({
      success: true,
      message: `Logged out from all sessions`,
      sessionsTerminated: result.modifiedCount
    });
  } catch (error) {
    logger.error("Error logging out from all sessions:", error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: "Failed to logout from all sessions"
      });
    }
  }
});

export default router;
