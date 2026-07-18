// Jest setup for API package
const dotenv = require('dotenv');
dotenv.config({ path: '.env.test' });

// Mock MongoDB. `Types.ObjectId` is sourced from `bson` (mongoose's own ObjectId
// implementation — `mongoose.Types.ObjectId` IS bson's `ObjectId`), so id
// validation (`Types.ObjectId.isValid`) stays byte-identical to production while
// loading none of mongoose's connection machinery.
const { ObjectId } = jest.requireActual('bson');
const schemaInstance = {
  pre: jest.fn(),
  post: jest.fn(),
  virtual: jest.fn(() => ({ get: jest.fn() })),
  index: jest.fn(),
  methods: {},
  statics: {},
};
const Schema = jest.fn(() => schemaInstance);
Schema.Types = { ObjectId };

jest.mock('mongoose', () => ({
  Types: { ObjectId },
  connect: jest.fn(() => Promise.resolve()),
  connection: {
    on: jest.fn(),
    once: jest.fn(),
  },
  Schema,
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
