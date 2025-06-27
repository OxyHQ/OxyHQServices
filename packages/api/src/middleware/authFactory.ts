import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import User, { IUser } from '../models/User'; // Assuming IUser is the user interface
import { logger } from '../utils/logger'; // Assuming a logger utility

export interface AuthFactoryOptions {
  tokenSecret: string;
  userModel?: any; // Allow passing a custom user model for flexibility
}

export interface AuthenticatedRequest extends Request {
  user?: IUser | any; // Adjust 'any' to your user type
}

/**
 * Creates an authentication middleware.
 * This middleware verifies a JWT token from the Authorization header (Bearer token)
 * and attaches the authenticated user to the request object.
 */
export function createAuthMiddleware(options: AuthFactoryOptions) {
  const UserEntity = options.userModel || User;

  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.warn('[AuthFactory] No token or invalid format provided');
      return res.status(401).json({ message: 'Authentication token required.' });
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      logger.warn('[AuthFactory] Token missing after Bearer split');
      return res.status(401).json({ message: 'Authentication token is missing.' });
    }

    try {
      const decoded = jwt.verify(token, options.tokenSecret) as any; // Adjust 'any' to your decoded token type

      if (!decoded || !decoded.id) {
        logger.warn('[AuthFactory] Token decoding failed or ID missing in token', { tokenPayload: decoded });
        return res.status(401).json({ message: 'Invalid token: Payload missing ID.' });
      }

      // Fetch user from database. Select appropriate fields.
      // Exclude password and other sensitive fields by default.
      const user = await UserEntity.findById(decoded.id).select('-password -refreshToken');

      if (!user) {
        logger.warn(`[AuthFactory] User not found for token ID: ${decoded.id}`);
        return res.status(401).json({ message: 'Invalid token: User not found.' });
      }

      req.user = user; // Attach user to request
      next();
    } catch (error: any) {
      logger.error('[AuthFactory] Token verification failed:', { error: error.message, name: error.name });
      if (error instanceof jwt.TokenExpiredError) {
        return res.status(401).json({ message: 'Token expired.' });
      }
      if (error instanceof jwt.JsonWebTokenError) {
        return res.status(401).json({ message: 'Invalid token.' });
      }
      return res.status(500).json({ message: 'Could not process token.' });
    }
  };
}

/**
 * Auth factory to create and configure authentication components.
 *
 * @example
 * const auth = createAuth({ tokenSecret: process.env.ACCESS_TOKEN_SECRET });
 * app.use('/protected-route', auth.middleware());
 * // For a specific route:
 * // app.get('/another-protected', auth.middleware(), (req, res) => { ... });
 */
export function createAuth(options: AuthFactoryOptions) {
  if (!options.tokenSecret) {
    throw new Error('[AuthFactory] Token secret must be provided.');
  }

  return {
    /**
     * Returns the authentication middleware.
     */
    middleware: () => createAuthMiddleware(options),
    // Potentially add other auth-related utilities here in the future,
    // e.g., a function to issue tokens, handle roles/permissions, etc.
  };
}
