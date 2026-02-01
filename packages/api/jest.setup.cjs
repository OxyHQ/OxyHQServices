// Jest setup for API package
const dotenv = require('dotenv');
dotenv.config({ path: '.env.test' });

// Mock MongoDB
jest.mock('mongoose', () => ({
  connect: jest.fn(() => Promise.resolve()),
  connection: {
    on: jest.fn(),
    once: jest.fn(),
  },
  Schema: jest.fn(() => ({
    pre: jest.fn(),
    post: jest.fn(),
    virtual: jest.fn(() => ({ get: jest.fn() })),
  })),
  model: jest.fn(() => ({
    find: jest.fn(() => ({ populate: jest.fn(() => Promise.resolve([])) })),
    findOne: jest.fn(() => ({ populate: jest.fn(() => Promise.resolve(null)) })),
    findById: jest.fn(() => ({ populate: jest.fn(() => Promise.resolve(null)) })),
    create: jest.fn(() => Promise.resolve({})),
    findByIdAndUpdate: jest.fn(() => Promise.resolve({})),
    findByIdAndDelete: jest.fn(() => Promise.resolve({})),
    countDocuments: jest.fn(() => Promise.resolve(0)),
  })),
}));

// Mock bcrypt
jest.mock('bcrypt', () => ({
  hash: jest.fn(() => Promise.resolve('hashed-password')),
  compare: jest.fn(() => Promise.resolve(true)),
}));

// Mock jsonwebtoken
jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(() => 'mock-jwt-token'),
  verify: jest.fn(() => ({ userId: 'test-user-id', sessionId: 'test-session-id' })),
}));

// Mock socket.io
jest.mock('socket.io', () => ({
  Server: jest.fn(() => ({
    on: jest.fn(),
    emit: jest.fn(),
    to: jest.fn(() => ({ emit: jest.fn() })),
  })),
}));

// Set test timeout
jest.setTimeout(10000);
