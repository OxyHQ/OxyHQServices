import {
  isRequiredString,
  isRequiredNumber,
  isRequiredBoolean,
  isValidArray,
  isValidObject,
  isValidEmail,
  isValidUsername,
  isValidPassword,
  isValidUUID,
  isValidDate,
  isValidFileSize,
  isValidFileType,
  sanitizeString,
  sanitizeHTML,
  validateAndSanitizeUserInput
} from '../validationUtils';

describe('Validation Utils', () => {
  describe('isRequiredString', () => {
    it('should return true for valid non-empty strings', () => {
      expect(isRequiredString('hello')).toBe(true);
      expect(isRequiredString('  hello  ')).toBe(true); // trims whitespace
    });

    it('should return false for invalid or empty strings', () => {
      expect(isRequiredString('')).toBe(false);
      expect(isRequiredString('   ')).toBe(false); // only whitespace
      expect(isRequiredString(null)).toBe(false);
      expect(isRequiredString(undefined)).toBe(false);
      expect(isRequiredString(123)).toBe(false);
    });
  });

  describe('isRequiredNumber', () => {
    it('should return true for valid numbers', () => {
      expect(isRequiredNumber(123)).toBe(true);
      expect(isRequiredNumber(0)).toBe(true);
      expect(isRequiredNumber(-456)).toBe(true);
      expect(isRequiredNumber(3.14)).toBe(true);
    });

    it('should return false for invalid numbers', () => {
      expect(isRequiredNumber(Number.NaN)).toBe(false);
      expect(isRequiredNumber('123')).toBe(false);
      expect(isRequiredNumber(null)).toBe(false);
      expect(isRequiredNumber(undefined)).toBe(false);
    });
  });

  describe('isRequiredBoolean', () => {
    it('should return true for boolean values', () => {
      expect(isRequiredBoolean(true)).toBe(true);
      expect(isRequiredBoolean(false)).toBe(true);
    });

    it('should return false for non-boolean values', () => {
      expect(isRequiredBoolean('true')).toBe(false);
      expect(isRequiredBoolean(1)).toBe(false);
      expect(isRequiredBoolean(0)).toBe(false);
      expect(isRequiredBoolean(null)).toBe(false);
      expect(isRequiredBoolean(undefined)).toBe(false);
    });
  });

  describe('isValidArray', () => {
    it('should return true for arrays', () => {
      expect(isValidArray([])).toBe(true);
      expect(isValidArray([1, 2, 3])).toBe(true);
      expect(isValidArray(['a', 'b'])).toBe(true);
    });

    it('should return false for non-arrays', () => {
      expect(isValidArray({})).toBe(false);
      expect(isValidArray('[]')).toBe(false);
      expect(isValidArray(null)).toBe(false);
      expect(isValidArray(undefined)).toBe(false);
    });
  });

  describe('isValidObject', () => {
    it('should return true for plain objects', () => {
      expect(isValidObject({})).toBe(true);
      expect(isValidObject({ key: 'value' })).toBe(true);
    });

    it('should return false for non-objects', () => {
      expect(isValidObject([])).toBe(false);
      expect(isValidObject(null)).toBe(false);
      expect(isValidObject(undefined)).toBe(false);
      expect(isValidObject('object')).toBe(false);
      expect(isValidObject(123)).toBe(false);
    });
  });

  describe('isValidEmail', () => {
    it('should return true for valid email addresses', () => {
      expect(isValidEmail('test@example.com')).toBe(true);
      expect(isValidEmail('user.name+tag@domain.co.uk')).toBe(true);
      expect(isValidEmail('simple@test.io')).toBe(true);
    });

    it('should return false for invalid email addresses', () => {
      expect(isValidEmail('invalid-email')).toBe(false);
      expect(isValidEmail('test@')).toBe(false);
      expect(isValidEmail('@domain.com')).toBe(false);
      expect(isValidEmail('test.domain.com')).toBe(false);
      expect(isValidEmail('')).toBe(false);
    });
  });

  describe('isValidUsername', () => {
    it('should return true for valid usernames', () => {
      expect(isValidUsername('user123')).toBe(true);
      expect(isValidUsername('test_user')).toBe(true);
      expect(isValidUsername('john-doe')).toBe(true);
    });

    it('should return false for invalid usernames', () => {
      expect(isValidUsername('')).toBe(false);
      expect(isValidUsername('a')).toBe(false); // too short
      expect(isValidUsername('ab')).toBe(false); // too short
      expect(isValidUsername('user@domain')).toBe(false); // invalid characters
      expect(isValidUsername('user with spaces')).toBe(false); // spaces
    });
  });

  describe('isValidPassword', () => {
    it('should return true for valid passwords', () => {
      expect(isValidPassword('password123')).toBe(true);
      expect(isValidPassword('mySecurePass')).toBe(true);
      expect(isValidPassword('12345678')).toBe(true);
    });

    it('should return false for invalid passwords', () => {
      expect(isValidPassword('')).toBe(false);
      expect(isValidPassword('short')).toBe(false); // too short
      expect(isValidPassword('1234567')).toBe(false); // too short
    });
  });

  describe('isValidUUID', () => {
    it('should return true for valid UUIDs', () => {
      expect(isValidUUID('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
      expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    });

    it('should return false for invalid UUIDs', () => {
      expect(isValidUUID('invalid-uuid')).toBe(false);
      expect(isValidUUID('123-456-789')).toBe(false);
      expect(isValidUUID('')).toBe(false);
    });
  });

  describe('isValidDate', () => {
    it('should return true for valid date strings', () => {
      expect(isValidDate('2024-01-01')).toBe(true);
      expect(isValidDate('2024-12-31T23:59:59.999Z')).toBe(true);
      expect(isValidDate('January 1, 2024')).toBe(true);
    });

    it('should return false for invalid date strings', () => {
      expect(isValidDate('invalid-date')).toBe(false);
      expect(isValidDate('2024-13-01')).toBe(false); // invalid month
      expect(isValidDate('')).toBe(false);
    });
  });

  describe('isValidFileSize', () => {
    const maxSize = 1024 * 1024; // 1MB

    it('should return true for valid file sizes', () => {
      expect(isValidFileSize(1024, maxSize)).toBe(true);
      expect(isValidFileSize(maxSize, maxSize)).toBe(true);
      expect(isValidFileSize(1, maxSize)).toBe(true);
    });

    it('should return false for invalid file sizes', () => {
      expect(isValidFileSize(0, maxSize)).toBe(false);
      expect(isValidFileSize(-1, maxSize)).toBe(false);
      expect(isValidFileSize(maxSize + 1, maxSize)).toBe(false);
    });
  });

  describe('isValidFileType', () => {
    const allowedTypes = ['jpg', 'png', 'gif', 'pdf'];

    it('should return true for allowed file types', () => {
      expect(isValidFileType('image.jpg', allowedTypes)).toBe(true);
      expect(isValidFileType('document.PDF', allowedTypes)).toBe(true); // case insensitive
      expect(isValidFileType('photo.png', allowedTypes)).toBe(true);
    });

    it('should return false for disallowed file types', () => {
      expect(isValidFileType('script.js', allowedTypes)).toBe(false);
      expect(isValidFileType('data.txt', allowedTypes)).toBe(false);
      expect(isValidFileType('noextension', allowedTypes)).toBe(false);
    });
  });

  describe('sanitizeString', () => {
    it('should trim whitespace and remove dangerous characters', () => {
      expect(sanitizeString('  hello  ')).toBe('hello');
      expect(sanitizeString('hello<script>alert("xss")</script>world')).toBe('helloalert("xss")world');
      expect(sanitizeString('normal text')).toBe('normal text');
    });
  });

  describe('sanitizeHTML', () => {
    it('should escape HTML characters', () => {
      expect(sanitizeHTML('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
      expect(sanitizeHTML('Hello & Goodbye')).toBe('Hello &amp; Goodbye');
      expect(sanitizeHTML("It's a test")).toBe('It&#x27;s a test');
    });
  });

  describe('validateAndSanitizeUserInput', () => {
    it('should validate and sanitize email input', () => {
      expect(validateAndSanitizeUserInput('  test@example.com  ', 'email')).toBe('test@example.com');
      expect(validateAndSanitizeUserInput('invalid-email', 'email')).toBeNull();
      expect(validateAndSanitizeUserInput(123, 'email')).toBeNull();
    });

    it('should validate and sanitize username input', () => {
      expect(validateAndSanitizeUserInput('  testuser  ', 'username')).toBe('testuser');
      expect(validateAndSanitizeUserInput('ab', 'username')).toBeNull(); // too short
      expect(validateAndSanitizeUserInput(123, 'username')).toBeNull();
    });

    it('should validate and sanitize string input', () => {
      expect(validateAndSanitizeUserInput('  hello world  ', 'string')).toBe('hello world');
      expect(validateAndSanitizeUserInput('', 'string')).toBeNull();
      expect(validateAndSanitizeUserInput(123, 'string')).toBeNull();
    });
  });
});
