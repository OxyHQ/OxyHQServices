import {
  createAccountRequestSchema,
  organizationCategorySchema,
} from '../accountGraph';
import { userResponseSchema } from '../userResponse';

describe('@oxyhq/contracts accountGraph', () => {
  it('accepts organizationCategory only for kind organization', () => {
    const ok = createAccountRequestSchema.safeParse({
      kind: 'organization',
      username: 'acme-realty',
      organizationCategory: 'agency',
    });
    expect(ok.success).toBe(true);

    const bad = createAccountRequestSchema.safeParse({
      kind: 'project',
      username: 'my-project',
      organizationCategory: 'agency',
    });
    expect(bad.success).toBe(false);
  });

  it('parses organizationCategory on user responses', () => {
    const parsed = userResponseSchema.safeParse({
      id: '507f1f77bcf86cd799439011',
      username: 'acme',
      name: { displayName: 'Acme Realty' },
      organizationCategory: 'agency',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.organizationCategory).toBe('agency');
    }
  });

  it('rejects unknown organization categories', () => {
    const parsed = organizationCategorySchema.safeParse('broker');
    expect(parsed.success).toBe(false);
  });
});
