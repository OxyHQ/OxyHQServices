import { privacySettingsSchema } from '../../schemas/privacy.schemas';

describe('privacy fediverseSharing write path', () => {
  it('accepts fediverseSharing in the privacy settings payload', () => {
    expect(privacySettingsSchema.parse({ fediverseSharing: false })).toEqual({
      fediverseSharing: false,
    });
  });
});
