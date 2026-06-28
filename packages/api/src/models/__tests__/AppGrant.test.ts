// The global jest.setup.cjs mocks `mongoose` wholesale; the real AppGrant schema
// (required fields, defaults, the unique compound index) only builds against the
// actual module, so restore it for this suite.
jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return { __esModule: true, ...actual, default: actual };
});

import mongoose from 'mongoose';
import { AppGrant } from '../AppGrant';

const USER_ID = new mongoose.Types.ObjectId().toString();
const APP_ID = new mongoose.Types.ObjectId().toString();

describe('AppGrant model', () => {
  it('validates with userId + applicationId and applies defaults', () => {
    const grant = new AppGrant({ userId: USER_ID, applicationId: APP_ID });

    expect(grant.validateSync()).toBeUndefined();
    expect(Array.isArray(grant.scopes)).toBe(true);
    expect(grant.scopes).toHaveLength(0);
    expect(grant.firstGrantedAt).toBeInstanceOf(Date);
    expect(grant.lastUsedAt).toBeInstanceOf(Date);
  });

  it('requires userId', () => {
    const grant = new AppGrant({ applicationId: APP_ID });
    expect(grant.validateSync()?.errors.userId).toBeDefined();
  });

  it('requires applicationId', () => {
    const grant = new AppGrant({ userId: USER_ID });
    expect(grant.validateSync()?.errors.applicationId).toBeDefined();
  });

  it('accepts an explicit scopes array', () => {
    const grant = new AppGrant({
      userId: USER_ID,
      applicationId: APP_ID,
      scopes: ['profile:read', 'email:read'],
    });
    expect(grant.validateSync()).toBeUndefined();
    expect(grant.scopes).toEqual(['profile:read', 'email:read']);
  });

  it('declares a unique compound index on { userId, applicationId }', () => {
    const indexes = AppGrant.schema.indexes();
    const compound = indexes.find(
      ([fields]) => fields.userId === 1 && fields.applicationId === 1
    );
    expect(compound).toBeDefined();
    expect(compound?.[1]).toMatchObject({ unique: true });
  });
});
