import { OXY_SERVICE_ENVIRONMENTS } from '../oxyServiceEnvironment';

describe('OXY_SERVICE_ENVIRONMENTS', () => {
  it('lists exactly development, staging, production, in that order', () => {
    expect(OXY_SERVICE_ENVIRONMENTS).toEqual(['development', 'staging', 'production']);
  });
});
