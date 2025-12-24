/**
 * Tests for Username Validation Utilities
 */

import {
  validateUsername,
  validateAndSanitizeUsername,
  isValidUsername,
} from '../usernameValidation';

describe('validateUsername', () => {
  describe('valid usernames', () => {
    it('should accept alphanumeric username', () => {
      const result = validateUsername('user123');
      expect(result.valid).toBe(true);
      expect(result.trimmedUsername).toBe('user123');
      expect(result.error).toBeUndefined();
    });

    it('should accept minimum length username', () => {
      const result = validateUsername('abc');
      expect(result.valid).toBe(true);
      expect(result.trimmedUsername).toBe('abc');
    });

    it('should accept maximum length username', () => {
      const username = 'a'.repeat(30);
      const result = validateUsername(username);
      expect(result.valid).toBe(true);
      expect(result.trimmedUsername).toBe(username);
    });

    it('should trim whitespace from valid username', () => {
      const result = validateUsername('  user123  ');
      expect(result.valid).toBe(true);
      expect(result.trimmedUsername).toBe('user123');
    });

    it('should accept uppercase letters', () => {
      const result = validateUsername('UserName123');
      expect(result.valid).toBe(true);
      expect(result.trimmedUsername).toBe('UserName123');
    });
  });

  describe('invalid usernames', () => {
    it('should reject non-string input', () => {
      const result = validateUsername(123 as any);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Username must be a string');
    });

    it('should reject null', () => {
      const result = validateUsername(null as any);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Username must be a string');
    });

    it('should reject undefined', () => {
      const result = validateUsername(undefined as any);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Username must be a string');
    });

    it('should reject empty string', () => {
      const result = validateUsername('');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Username cannot be empty');
    });

    it('should reject whitespace-only string', () => {
      const result = validateUsername('   ');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Username cannot be empty');
    });

    it('should reject username too short', () => {
      const result = validateUsername('ab');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('at least 3 characters');
    });

    it('should reject username too long', () => {
      const username = 'a'.repeat(31);
      const result = validateUsername(username);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('cannot exceed 30 characters');
    });

    it('should reject username with spaces', () => {
      const result = validateUsername('user name');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Username must contain only letters and numbers');
    });

    it('should reject username with special characters', () => {
      const result = validateUsername('user@123');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Username must contain only letters and numbers');
    });

    it('should reject username with underscore', () => {
      const result = validateUsername('user_123');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Username must contain only letters and numbers');
    });

    it('should reject username with hyphen', () => {
      const result = validateUsername('user-123');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Username must contain only letters and numbers');
    });

    it('should reject username with dots', () => {
      const result = validateUsername('user.123');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Username must contain only letters and numbers');
    });
  });
});

describe('validateAndSanitizeUsername', () => {
  it('should return trimmed username for valid input', () => {
    const result = validateAndSanitizeUsername('  user123  ');
    expect(result).toBe('user123');
  });

  it('should throw error for invalid username', () => {
    expect(() => validateAndSanitizeUsername('ab')).toThrow('at least 3 characters');
  });

  it('should throw error for non-string input', () => {
    expect(() => validateAndSanitizeUsername(123 as any)).toThrow('Username must be a string');
  });

  it('should throw error for username with special characters', () => {
    expect(() => validateAndSanitizeUsername('user@123')).toThrow('only letters and numbers');
  });
});

describe('isValidUsername', () => {
  it('should return true for valid username', () => {
    expect(isValidUsername('user123')).toBe(true);
  });

  it('should return false for invalid username', () => {
    expect(isValidUsername('ab')).toBe(false);
  });

  it('should return false for non-string', () => {
    expect(isValidUsername(123)).toBe(false);
  });

  it('should return false for username with special characters', () => {
    expect(isValidUsername('user@123')).toBe(false);
  });
});

describe('edge cases', () => {
  it('should handle username with leading/trailing spaces', () => {
    const result = validateUsername('   user123   ');
    expect(result.valid).toBe(true);
    expect(result.trimmedUsername).toBe('user123');
  });

  it('should handle mixed case username', () => {
    const result = validateUsername('UsErNaMe123');
    expect(result.valid).toBe(true);
    expect(result.trimmedUsername).toBe('UsErNaMe123');
  });

  it('should handle numbers-only username', () => {
    const result = validateUsername('123456');
    expect(result.valid).toBe(true);
    expect(result.trimmedUsername).toBe('123456');
  });

  it('should handle letters-only username', () => {
    const result = validateUsername('username');
    expect(result.valid).toBe(true);
    expect(result.trimmedUsername).toBe('username');
  });
});
