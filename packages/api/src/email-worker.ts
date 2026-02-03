/**
 * Email Worker — Standalone SMTP Server Process
 *
 * This is a separate entry point that runs ONLY the SMTP inbound/outbound
 * services. It connects to the same MongoDB as the main API but does NOT
 * start Express or any HTTP routes.
 *
 * Designed to run on a DigitalOcean Droplet (or any VPS) where port 25 is
 * accessible, while the main API continues running on App Platform.
 *
 * Usage:
 *   node dist/email-worker.js
 *
 * Both this worker and the API share the same MongoDB — messages stored
 * by the SMTP worker are immediately visible via the /email/* REST endpoints.
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { logger } from './utils/logger';
import { startSmtpInbound, stopSmtpInbound } from './services/smtp.inbound';
import { smtpOutbound } from './services/smtp.outbound';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  logger.error('MONGODB_URI environment variable is required');
  process.exit(1);
}

// MongoDB connection (same config as main server)
const mongoOptions = {
  autoIndex: true,
  autoCreate: true,
  maxPoolSize: 10,
  minPoolSize: 2,
  maxIdleTimeMS: 30000,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  connectTimeoutMS: 10000,
  heartbeatFrequencyMS: 10000,
  retryWrites: true,
  retryReads: true,
  bufferCommands: false,
};

async function start(): Promise<void> {
  logger.info('Starting Oxy Email Worker...');

  // Connect to MongoDB
  await mongoose.connect(MONGODB_URI!, mongoOptions);
  logger.info('MongoDB connected');

  mongoose.connection.on('error', (err) => {
    logger.error('MongoDB connection error:', err);
  });

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
  });

  mongoose.connection.on('reconnected', () => {
    logger.info('MongoDB reconnected');
  });

  // Start SMTP inbound server
  startSmtpInbound();
  logger.info('SMTP inbound server started');

  // Outbound service is initialized on import (ready to send)
  logger.info('SMTP outbound service ready');

  logger.info('Oxy Email Worker is running');
}

// Graceful shutdown
async function shutdown(): Promise<void> {
  logger.info('Shutting down Email Worker...');
  await stopSmtpInbound();
  smtpOutbound.shutdown();
  await mongoose.connection.close();
  logger.info('Email Worker stopped');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start().catch((error) => {
  logger.error('Email Worker failed to start:', error);
  process.exit(1);
});
