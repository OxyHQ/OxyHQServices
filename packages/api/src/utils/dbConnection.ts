/**
 * MongoDB Connection Utilities
 * 
 * Provides helpers for checking MongoDB connection state and waiting for connections.
 * Used to prevent queries from executing before the database is ready.
 */

import mongoose from 'mongoose';
import { logger } from './logger';

/**
 * Check if MongoDB is currently connected
 * 
 * @returns true if connected (readyState === 1), false otherwise
 */
export function isMongoConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

/**
 * Wait for MongoDB connection to be established
 * 
 * @param timeout - Maximum time to wait in milliseconds (default: 30000ms)
 * @returns Promise that resolves when connected or rejects on timeout
 * @throws Error if connection timeout is exceeded
 */
export function waitForMongoConnection(timeout: number = 30000): Promise<void> {
  return new Promise((resolve, reject) => {
    // If already connected, resolve immediately
    if (mongoose.connection.readyState === 1) {
      logger.debug('MongoDB already connected');
      resolve();
      return;
    }

    // Set up timeout
    const timeoutId = setTimeout(() => {
      mongoose.connection.removeListener('connected', onConnected);
      mongoose.connection.removeListener('error', onError);
      reject(new Error(`MongoDB connection timeout after ${timeout}ms`));
    }, timeout);

    // Set up success handler
    const onConnected = () => {
      clearTimeout(timeoutId);
      mongoose.connection.removeListener('error', onError);
      logger.info('MongoDB connection established (via waitForMongoConnection)');
      resolve();
    };

    // Set up error handler
    const onError = (err: Error) => {
      clearTimeout(timeoutId);
      mongoose.connection.removeListener('connected', onConnected);
      logger.error('MongoDB connection error (via waitForMongoConnection):', err);
      reject(err);
    };

    // Listen for connection events
    mongoose.connection.once('connected', onConnected);
    mongoose.connection.once('error', onError);
  });
}

/**
 * Get human-readable connection state
 * 
 * @returns String describing current connection state
 */
export function getConnectionState(): string {
  const states = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };
  return states[mongoose.connection.readyState as keyof typeof states] || 'unknown';
}

