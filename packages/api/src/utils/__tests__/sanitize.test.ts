import {
  sanitizeHtml,
  sanitizeString,
  sanitizeObject,
  sanitizeProfileUpdate,
  sanitizeSearchQuery,
  decodeHtmlEntities,
} from '../sanitize';

describe('sanitize utilities', () => {
  describe('sanitizeHtml', () => {
    it('escapes ampersands', () => {
      expect(sanitizeHtml('a & b')).toBe('a &amp; b');
    });

    it('escapes angle brackets', () => {
      expect(sanitizeHtml('<script>alert(1)</script>')).toBe(
        '&lt;script&gt;alert(1)&lt;/script&gt;'
      );
    });

    it('escapes double quotes', () => {
      expect(sanitizeHtml('"hello"')).toBe('&quot;hello&quot;');
    });

    it('escapes single quotes', () => {
      expect(sanitizeHtml("it's")).toBe('it&#x27;s');
    });

    it('handles strings with no special characters', () => {
      expect(sanitizeHtml('plain text')).toBe('plain text');
    });

    it('handles empty string', () => {
      expect(sanitizeHtml('')).toBe('');
    });

    it('escapes all special characters together', () => {
      expect(sanitizeHtml('<a href="x" onclick=\'y\'>&')).toBe(
        '&lt;a href=&quot;x&quot; onclick=&#x27;y&#x27;&gt;&amp;'
      );
    });
  });

  describe('sanitizeString', () => {
    it('sanitizes strings', () => {
      expect(sanitizeString('<b>bold</b>')).toBe('&lt;b&gt;bold&lt;/b&gt;');
    });

    it('returns non-strings as-is', () => {
      expect(sanitizeString(42)).toBe(42);
      expect(sanitizeString(null)).toBe(null);
      expect(sanitizeString(undefined)).toBe(undefined);
    });
  });

  describe('sanitizeObject', () => {
    it('sanitizes all string values', () => {
      const result = sanitizeObject({ name: '<b>Joe</b>', age: 30 });
      expect(result.name).toBe('&lt;b&gt;Joe&lt;/b&gt;');
      expect(result.age).toBe(30);
    });

    it('skips fields in skipFields list', () => {
      const result = sanitizeObject(
        { password: '<script>', bio: '<b>hi</b>' },
        ['password']
      );
      expect(result.password).toBe('<script>');
      expect(result.bio).toBe('&lt;b&gt;hi&lt;/b&gt;');
    });
  });

  describe('sanitizeProfileUpdate', () => {
    it('sanitizes text fields', () => {
      const result = sanitizeProfileUpdate({
        bio: '<script>alert(1)</script>',
        username: 'test<user>',
      });
      expect(result.bio).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(result.username).toBe('test&lt;user&gt;');
    });

    it('skips avatar, email, password, links, linksMetadata, locations', () => {
      const result = sanitizeProfileUpdate({
        avatar: 'file-id-123',
        email: 'test@test.com',
        password: '<secret>',
        links: ['http://example.com'],
        linksMetadata: [{ url: 'http://example.com' }],
        locations: [{ name: '<b>NYC</b>' }],
      });
      expect(result.avatar).toBe('file-id-123');
      expect(result.email).toBe('test@test.com');
      expect(result.password).toBe('<secret>');
    });

    it('does NOT escape the name field — names are validated to a strict char policy upstream', () => {
      // Display names are letters/spaces/apostrophe only and can never contain
      // an XSS vector, so escaping here would corrupt the inert apostrophe.
      const result = sanitizeProfileUpdate({
        name: { first: "O'Brien", last: 'Doe' },
      });
      expect((result.name as { first: string }).first).toBe("O'Brien");
      expect((result.name as { last: string }).last).toBe('Doe');
    });
  });

  describe('decodeHtmlEntities', () => {
    it('decodes the hex apostrophe entity', () => {
      expect(decodeHtmlEntities('O&#x27;Brien')).toBe("O'Brien");
    });

    it('decodes the numeric apostrophe entity', () => {
      expect(decodeHtmlEntities('O&#39;Brien')).toBe("O'Brien");
    });

    it('decodes named entities', () => {
      expect(decodeHtmlEntities('A &amp; B &lt;x&gt; &quot;q&quot; &apos;a&apos;')).toBe(
        'A & B <x> "q" \'a\''
      );
    });

    it('round-trips with sanitizeHtml', () => {
      const raw = '<a href="x">O\'Neil & co</a>';
      expect(decodeHtmlEntities(sanitizeHtml(raw))).toBe(raw);
    });

    it('returns empty/falsy input unchanged', () => {
      expect(decodeHtmlEntities('')).toBe('');
    });
  });

  describe('sanitizeSearchQuery', () => {
    it('trims whitespace', () => {
      expect(sanitizeSearchQuery('  hello  ')).toBe('hello');
    });

    it('limits length', () => {
      const long = 'a'.repeat(200);
      expect(sanitizeSearchQuery(long)).toHaveLength(100);
    });

    it('accepts custom max length', () => {
      expect(sanitizeSearchQuery('abcdef', 3)).toBe('abc');
    });

    it('escapes HTML in query', () => {
      expect(sanitizeSearchQuery('<script>')).toBe('&lt;script&gt;');
    });
  });
});
