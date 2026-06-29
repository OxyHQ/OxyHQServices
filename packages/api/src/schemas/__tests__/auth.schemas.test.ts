import { signupSchema } from '../auth.schemas';

const base = {
  email: 'user@example.com',
  username: 'cleanuser',
  password: 'supersecret1',
};

describe('signupSchema — display-name character policy', () => {
  it('rejects an invalid name.first with the policy message', () => {
    const result = signupSchema.safeParse({ ...base, name: { first: 'nixCraft 🐧' } });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join('.') === 'name.first');
      expect(issue?.message).toBe('Name may only contain letters, spaces and apostrophes.');
    }
  });

  it('rejects an invalid name.last', () => {
    const result = signupSchema.safeParse({ ...base, name: { last: 'Laura :bongoCat:' } });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join('.') === 'name.last')).toBe(true);
    }
  });

  it("accepts a clean name with accents and an apostrophe", () => {
    const result = signupSchema.safeParse({
      ...base,
      name: { first: 'Renée', last: "O'Brien" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toEqual({ first: 'Renée', last: "O'Brien" });
    }
  });

  it('accepts a signup with no name at all', () => {
    const result = signupSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it.each(['Dabid ⁂', 'Axe vert de La Ramée ⏚', 'Agent007', 'Jean-Luc'])(
    'rejects dirty name.first %p',
    (first) => {
      expect(signupSchema.safeParse({ ...base, name: { first } }).success).toBe(false);
    },
  );
});
