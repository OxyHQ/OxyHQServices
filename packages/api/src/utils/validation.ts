import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';

// Common validation schemas
export const userSchemas = {
  signup: z.object({
    username: z.string()
      .min(3, 'Username must be at least 3 characters')
      .max(30, 'Username must be less than 30 characters')
      .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores'),
    email: z.string()
      .email('Invalid email format')
      .min(5, 'Email must be at least 5 characters')
      .max(255, 'Email must be less than 255 characters'),
    password: z.string()
      .min(8, 'Password must be at least 8 characters')
      .max(128, 'Password must be less than 128 characters')
      .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'Password must contain at least one uppercase letter, one lowercase letter, and one number')
  }),

  login: z.object({
    email: z.string().email('Invalid email format'),
    password: z.string().min(1, 'Password is required')
  }),

  updateProfile: z.object({
    name: z.object({
      first: z.string().max(50, 'First name must be less than 50 characters').optional(),
      last: z.string().max(50, 'Last name must be less than 50 characters').optional()
    }).optional(),
    bio: z.string().max(500, 'Bio must be less than 500 characters').optional(),
    location: z.string().max(100, 'Location must be less than 100 characters').optional(),
    website: z.string().url('Invalid website URL').optional(),
    avatar: z.object({
      id: z.string().optional(),
      url: z.string().url('Invalid avatar URL').optional()
    }).optional()
  }),

  changePassword: z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string()
      .min(8, 'Password must be at least 8 characters')
      .max(128, 'Password must be less than 128 characters')
      .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'Password must contain at least one uppercase letter, one lowercase letter, and one number')
  })
};

export const sessionSchemas = {
  create: z.object({
    title: z.string()
      .min(1, 'Title is required')
      .max(100, 'Title must be less than 100 characters'),
    description: z.string()
      .max(500, 'Description must be less than 500 characters')
      .optional(),
    isPrivate: z.boolean().default(false),
    maxParticipants: z.number()
      .min(1, 'Max participants must be at least 1')
      .max(1000, 'Max participants must be less than 1000')
      .optional()
  }),

  update: z.object({
    title: z.string()
      .min(1, 'Title is required')
      .max(100, 'Title must be less than 100 characters')
      .optional(),
    description: z.string()
      .max(500, 'Description must be less than 500 characters')
      .optional(),
    isPrivate: z.boolean().optional(),
    maxParticipants: z.number()
      .min(1, 'Max participants must be at least 1')
      .max(1000, 'Max participants must be less than 1000')
      .optional()
  })
};

export const paginationSchema = z.object({
  page: z.coerce.number().min(1, 'Page must be at least 1').default(1),
  limit: z.coerce.number().min(1, 'Limit must be at least 1').max(100, 'Limit must be less than 100').default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc')
});

export const searchSchema = z.object({
  q: z.string().min(1, 'Search query is required').max(100, 'Search query must be less than 100 characters'),
  type: z.enum(['users', 'sessions', 'all']).default('all'),
  ...paginationSchema.shape
});

// Validation middleware factory
export const validate = (schema: z.ZodSchema) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validatedData = await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params
      });

      // Replace request data with validated data
      req.body = validatedData.body || req.body;
      req.query = validatedData.query || req.query;
      req.params = validatedData.params || req.params;

      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errors = error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message
        }));

        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors
        });
      }

      return res.status(500).json({
        success: false,
        message: 'Validation error'
      });
    }
  };
};

// Sanitization helpers
export const sanitizeInput = (input: string): string => {
  return input
    .trim()
    .replace(/[<>]/g, '') // Remove potential HTML tags
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, ''); // Remove event handlers
};

export const sanitizeEmail = (email: string): string => {
  return email.toLowerCase().trim();
};

export const sanitizeUsername = (username: string): string => {
  return username.toLowerCase().trim().replace(/[^a-z0-9_]/g, '');
};

// Rate limiting validation
export const rateLimitSchema = z.object({
  windowMs: z.number().min(60000, 'Window must be at least 1 minute').default(900000), // 15 minutes
  max: z.number().min(1, 'Max requests must be at least 1').max(10000, 'Max requests must be less than 10000').default(100),
  message: z.string().default('Too many requests, please try again later.')
});

// File upload validation
export const fileUploadSchema = z.object({
  maxSize: z.number().min(1024, 'Max size must be at least 1KB').max(10485760, 'Max size must be less than 10MB').default(5242880), // 5MB
  allowedTypes: z.array(z.string()).default(['image/jpeg', 'image/png', 'image/gif', 'image/webp']),
  maxFiles: z.number().min(1, 'Max files must be at least 1').max(10, 'Max files must be less than 10').default(1)
});

// Export validation middleware for specific routes
export const validateUserSignup = validate(userSchemas.signup);
export const validateUserLogin = validate(userSchemas.login);
export const validateProfileUpdate = validate(userSchemas.updateProfile);
export const validatePasswordChange = validate(userSchemas.changePassword);
export const validateSessionCreate = validate(sessionSchemas.create);
export const validateSessionUpdate = validate(sessionSchemas.update);
export const validatePagination = validate(paginationSchema);
export const validateSearch = validate(searchSchema); 