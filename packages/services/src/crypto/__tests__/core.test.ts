/**
 * Tests for the shared crypto core module
 * These tests verify that signature verification is consistent across platforms
 */

import {
  verifySignatureCore,
  isValidPublicKey,
  isValidPrivateKey,
  isTimestampFresh,
  buildAuthMessage,
  buildRegistrationMessage,
  buildRequestMessage,
  shortenPublicKey,
  derivePublicKey,
  getEllipticCurve,
  CHALLENGE_TTL_MS,
  MAX_SIGNATURE_AGE_MS,
} from '../core';

describe('Crypto Core Module', () => {
  // Test key pair (for testing only - never use in production)
  const testPrivateKey = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
  // Public key derived from the private key above
  const testPublicKey = '04bb50e2d89a4ed70663d080659fe0ad4b9bc3e06c17a227433966cb59ceee020decddbf6e00192011648d13b1c00af770c0c1bb609d4d3a5c98a43772e0e18ef4';
  
  describe('Public/Private Key Validation', () => {
    it('should validate correct public keys', () => {
      expect(isValidPublicKey(testPublicKey)).toBe(true);
    });

    it('should reject invalid public keys', () => {
      expect(isValidPublicKey('invalid')).toBe(false);
      expect(isValidPublicKey('')).toBe(false);
      expect(isValidPublicKey('1234')).toBe(false);
    });

    it('should validate correct private keys', () => {
      expect(isValidPrivateKey(testPrivateKey)).toBe(true);
    });

    it('should reject invalid private keys', () => {
      expect(isValidPrivateKey('invalid')).toBe(false);
      expect(isValidPrivateKey('')).toBe(false);
      expect(isValidPrivateKey('1234')).toBe(false);
    });

    it('should derive public key from private key', () => {
      const derived = derivePublicKey(testPrivateKey);
      expect(derived).toBe(testPublicKey);
    });
  });

  describe('Utility Functions', () => {
    it('should shorten public keys correctly', () => {
      const shortened = shortenPublicKey(testPublicKey);
      expect(shortened).toBe('04bb50e2...e0e18ef4');
      expect(shortened.length).toBeLessThan(testPublicKey.length);
    });

    it('should not shorten already short keys', () => {
      const shortKey = '1234567890';
      expect(shortenPublicKey(shortKey)).toBe(shortKey);
    });
  });

  describe('Timestamp Validation', () => {
    it('should accept fresh timestamps', () => {
      const now = Date.now();
      expect(isTimestampFresh(now)).toBe(true);
      expect(isTimestampFresh(now - 1000)).toBe(true); // 1 second ago
    });

    it('should reject old timestamps', () => {
      const old = Date.now() - (MAX_SIGNATURE_AGE_MS + 1000);
      expect(isTimestampFresh(old)).toBe(false);
    });

    it('should respect custom max age', () => {
      const timestamp = Date.now() - 10000; // 10 seconds ago
      expect(isTimestampFresh(timestamp, 5000)).toBe(false); // max 5 seconds
      expect(isTimestampFresh(timestamp, 15000)).toBe(true); // max 15 seconds
    });
  });

  describe('Message Building', () => {
    it('should build auth messages correctly', () => {
      const publicKey = 'abc123';
      const challenge = 'challenge456';
      const timestamp = 1234567890;
      
      const message = buildAuthMessage(publicKey, challenge, timestamp);
      expect(message).toBe('auth:abc123:challenge456:1234567890');
    });

    it('should build registration messages correctly', () => {
      const publicKey = 'abc123';
      const timestamp = 1234567890;
      
      const message = buildRegistrationMessage(publicKey, timestamp);
      expect(message).toBe('oxy:register:abc123:1234567890');
    });

    it('should build request messages with canonical data', () => {
      const publicKey = 'abc123';
      const timestamp = 1234567890;
      const data = {
        username: 'testuser',
        action: 'update',
        id: 42,
      };
      
      const message = buildRequestMessage(publicKey, timestamp, data);
      
      // Keys should be sorted alphabetically
      expect(message).toContain('action:"update"');
      expect(message).toContain('id:42');
      expect(message).toContain('username:"testuser"');
      expect(message).toContain('request:abc123:1234567890:');
    });

    it('should produce consistent canonical strings', () => {
      const publicKey = 'key';
      const timestamp = 1000;
      
      // Same data, different order
      const data1 = { b: 2, a: 1, c: 3 };
      const data2 = { c: 3, a: 1, b: 2 };
      
      const message1 = buildRequestMessage(publicKey, timestamp, data1);
      const message2 = buildRequestMessage(publicKey, timestamp, data2);
      
      expect(message1).toBe(message2);
    });
  });

  describe('Signature Verification Core', () => {
    it('should verify valid signatures', () => {
      const ec = getEllipticCurve();
      const keyPair = ec.keyFromPrivate(testPrivateKey);
      
      // Create a test message hash
      const messageHash = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      
      // Sign it
      const signature = keyPair.sign(messageHash);
      const signatureHex = signature.toDER('hex');
      
      // Verify it
      const isValid = verifySignatureCore(messageHash, signatureHex, testPublicKey);
      expect(isValid).toBe(true);
    });

    it('should reject invalid signatures', () => {
      const messageHash = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      const invalidSignature = '1234567890abcdef';
      
      const isValid = verifySignatureCore(messageHash, invalidSignature, testPublicKey);
      expect(isValid).toBe(false);
    });

    it('should reject signatures with wrong public key', () => {
      const ec = getEllipticCurve();
      const keyPair = ec.keyFromPrivate(testPrivateKey);
      
      const messageHash = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      const signature = keyPair.sign(messageHash);
      const signatureHex = signature.toDER('hex');
      
      // Use a different public key
      const wrongPublicKey = '04' + 'a'.repeat(128);
      
      const isValid = verifySignatureCore(messageHash, signatureHex, wrongPublicKey);
      expect(isValid).toBe(false);
    });
  });

  describe('Constants', () => {
    it('should export correct TTL constants', () => {
      expect(CHALLENGE_TTL_MS).toBe(5 * 60 * 1000); // 5 minutes
      expect(MAX_SIGNATURE_AGE_MS).toBe(5 * 60 * 1000); // 5 minutes
    });
  });

  describe('Elliptic Curve', () => {
    it('should provide secp256k1 curve', () => {
      const ec = getEllipticCurve();
      expect(ec).toBeDefined();
      expect(ec.curve.type).toBe('short');
    });

    it('should generate valid key pairs', () => {
      const ec = getEllipticCurve();
      const keyPair = ec.genKeyPair();
      
      const privateKey = keyPair.getPrivate('hex');
      const publicKey = keyPair.getPublic('hex');
      
      expect(isValidPrivateKey(privateKey)).toBe(true);
      expect(isValidPublicKey(publicKey)).toBe(true);
    });
  });
});
