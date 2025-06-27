import express from "express";
import http from "http";
import mongoose from "mongoose";
import { Server as SocketIOServer, Socket } from "socket.io";
import profilesRouter from "./routes/profiles";
import usersRouter from "./routes/users";
import authRouter from "./routes/auth"; // This is the existing auth router
import notificationsRouter from "./routes/notifications.routes";
import sessionsRouter from "./routes/sessions";
import secureSessionRouter from "./routes/secureSession";
import dotenv from "dotenv";
import fileRoutes from "./routes/files";
import { User } from "./models/User";
import searchRoutes from "./routes/search";
import { rateLimiter, bruteForceProtection } from "./middleware/security";
import privacyRoutes from "./routes/privacy";
import analyticsRoutes from "./routes/analytics.routes";
import paymentRoutes from './routes/payment.routes';
import walletRoutes from './routes/wallet.routes';
// import karmaRoutes from './routes/karma.routes'; // Was commented out
import jwt from 'jsonwebtoken';
import { createAuth } from './middleware/authFactory'; // Import the new auth factory

dotenv.config();

// Initialize the new auth factory
// Ensure ACCESS_TOKEN_SECRET is set in your .env file
const tokenSecret = process.env.ACCESS_TOKEN_SECRET;
if (!tokenSecret) {
  console.error("ACCESS_TOKEN_SECRET is not defined in environment variables. Auth factory will not work.");
  process.exit(1); // Or handle this more gracefully depending on your app's needs
}
const auth = createAuth({ tokenSecret });

const app = express();

// Body parsing middleware - IMPORTANT: Add this before any routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS middleware
app.use((req, res, next) => {
  const allowedOrigins = ["https://mention.earth", "https://homiio.com", "https://api.oxy.so", "https://authenticator.oxy.so", "https://noted.oxy.so/", "http://localhost:8081", "http://localhost:8082", "http://localhost:19006"];
  const origin = req.headers.origin as string;

  if (process.env.NODE_ENV !== 'production') {
    // In development allow all origins
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  } else if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else if (origin) {
    // If origin is present but not in allowedOrigins, check if it's a subdomain we want to allow
    const isDomainAllowed = allowedOrigins.some(allowed => 
      (origin.endsWith('.oxy.so'))
    );
    if (isDomainAllowed) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    }
  }
  
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Date, X-Api-Version");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  // Ensure OPTIONS requests always have CORS headers
  if (req.method === "OPTIONS") {
    // Prevent caching issues
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    return res.status(204).end();
  }

  next();
});

// Create server for local development and testing
const server = http.createServer(app);

// Setup Socket.IO
const io = new SocketIOServer(server, {
  cors: {
    origin: ["https://mention.earth", "https://homiio.com", "https://api.oxy.so", "http://localhost:8081", "http://localhost:8082", "http://localhost:19006", 
    /\.homiio\.com$/, /\.mention\.earth$/, /\.oxy\.so$/],
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Store io instance in app for use in controllers
app.set('io', io);

// Custom socket interface to include user property
interface AuthenticatedSocket extends Socket {
  user?: {
    id: string;
    [key: string]: any;
  };
}

// Socket.IO authentication middleware
io.use((socket: AuthenticatedSocket, next) => {
  const token = socket.handshake.auth.token;
  
  if (!token) {
    return next(new Error('Authentication error'));
  }
  
  try {
    // Verify the token
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET || 'default_secret');
    socket.user = decoded as { id: string, [key: string]: any };
    next();
  } catch (error) {
    console.error('Socket authentication error:', error);
    next(new Error('Authentication error'));
  }
});

// Socket connection handling
io.on('connection', (socket: AuthenticatedSocket) => {
  console.log('User connected:', socket.id);
  
  if (socket.user?.id) {
    // Join the user to their personal room for notifications
    socket.join(`user:${socket.user.id}`);
    console.log(`User ${socket.user.id} joined their notification room`);
  }
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Special handling for file upload requests with proper auth
app.use("/files", (req, res, next) => {
  if (req.path === "/upload" && req.method === "POST") {
    console.log("Incoming file upload request:", {
      method: req.method,
      contentType: req.headers["content-type"],
      contentLength: req.headers["content-length"],
      origin: req.headers.origin,
      authorization: !!req.headers.authorization,
    });
  }
  next();
});

// Register file routes with auth middleware
app.use("/files", fileRoutes);

// Apply rate limiting and security middleware to non-file upload routes
app.use((req, res, next) => {
  if (!req.path.startsWith("/files/upload")) {
    rateLimiter(req, res, (err: any) => {
      if (err) return next(err);
      bruteForceProtection(req, res, next);
    });
  } else {
    next();
  }
});

// Body parsing middleware - already applied at the top level, so this is redundant
// Removing the duplicate middleware registration

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || "", {
  autoIndex: true,
  autoCreate: true,
})
.then(() => {
  console.log("Connected to MongoDB successfully");
})
.catch((error) => {
  console.error("MongoDB connection error:", error);
  process.exit(1); // Exit on connection failure
});

// API Routes
app.get("/", async (req, res) => {
  try {
    const usersCount = await User.countDocuments();
    res.json({
      message: "Welcome to the API",
      users: usersCount,
    });
  } catch (error) {
    console.error("Error in root endpoint:", error);
    res.status(500).json({ message: "Error fetching stats", error: error instanceof Error ? error.message : String(error) });
  }
});

app.use("/search", searchRoutes); // Public or uses its own auth
app.use("/profiles", profilesRouter); // Requires auth for some operations, uses its own or needs update
app.use("/users", usersRouter); // Requires auth for many operations, uses its own or needs update

// Example of using the new auth middleware for a specific group of routes
// If you want to protect all /auth related routes (except login/signup/refresh which are public)
// you might need to structure your authRouter to apply middleware selectively or
// apply this middleware globally after public routes.
// For now, existing authRouter handles its own logic.
app.use("/auth", authRouter); // Existing auth routes (login, signup, refresh etc.)

// Apply the new middleware to routes that require authentication
// For example, if '/sessions' and '/secure-session' always require auth:
app.use("/sessions", auth.middleware(), sessionsRouter);
app.use("/secure-session", auth.middleware(), secureSessionRouter);

// For other routes, you can apply it similarly if they always need auth,
// or apply it selectively within their routers.
// Example:
// app.use("/privacy", auth.middleware(), privacyRoutes);
// Or if privacyRoutes has mixed public/private, it handles auth internally or selectively.
app.use("/privacy", privacyRoutes);


app.use("/analytics", auth.middleware(), analyticsRoutes); // Assuming analytics needs auth
app.use('/payments', auth.middleware(), paymentRoutes); // Assuming payments needs auth
app.use('/notifications', auth.middleware(), notificationsRouter); // Assuming notifications needs auth
// app.use('/karma', auth.middleware(), karmaRoutes); // If karma routes need auth
app.use('/wallet', auth.middleware(), walletRoutes); // Assuming wallet needs auth


// Global error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message
  });
});

// 404 handler for undefined routes
app.use((req: express.Request, res: express.Response) => {
  res.status(404).json({ message: 'Resource not found' });
});

// Only call listen if this module is run directly
const PORT = process.env.PORT || 3001;
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

export default server;
