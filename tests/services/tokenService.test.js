const tokenService = require('../../services/tokenService');
const User = require('../../models/user');
const TokenBlacklist = require('../../models/tokenBlacklist');

describe('TokenService', () => {
  let testUser;

  beforeEach(async () => {
    // Create test user
    testUser = new User({
      name: 'Test User',
      email: 'test@example.com',
      password: 'hashedpassword',
      role: 'user'
    });
    await testUser.save();
  });

  afterEach(async () => {
    // Clean up
    await User.deleteMany({});
    await TokenBlacklist.deleteMany({});
  });

  describe('Token Generation', () => {
    test('should generate access token', () => {
      const payload = { id: testUser._id, role: testUser.role };
      const token = tokenService.generateAccessToken(payload);
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
    });

    test('should generate refresh token', () => {
      const payload = { id: testUser._id, role: testUser.role };
      const token = tokenService.generateRefreshToken(payload);
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
    });

    test('should generate secure refresh token', () => {
      const token = tokenService.generateSecureRefreshToken();
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBe(128); // 64 bytes * 2 (hex)
    });
  });

  describe('Token Verification', () => {
    test('should verify valid access token', async () => {
      const payload = { id: testUser._id, role: testUser.role };
      const token = tokenService.generateAccessToken(payload);
      
      const decoded = await tokenService.verifyToken(token, 'access');
      
      expect(decoded.id).toBe(testUser._id.toString());
      expect(decoded.role).toBe(testUser.role);
    });

    test('should reject blacklisted token', async () => {
      const payload = { id: testUser._id, role: testUser.role };
      const token = tokenService.generateAccessToken(payload);
      
      // Blacklist the token
      await tokenService.blacklistToken(token, 'access', testUser._id);
      
      await expect(tokenService.verifyToken(token, 'access'))
        .rejects.toThrow('Token has been revoked');
    });

    test('should reject invalid token', async () => {
      const invalidToken = 'invalid.token.here';
      
      await expect(tokenService.verifyToken(invalidToken, 'access'))
        .rejects.toThrow('Invalid token');
    });
  });

  describe('Token Blacklisting', () => {
    test('should blacklist token successfully', async () => {
      const payload = { id: testUser._id, role: testUser.role };
      const token = tokenService.generateAccessToken(payload);
      
      const result = await tokenService.blacklistToken(
        token, 
        'access', 
        testUser._id, 
        'logout'
      );
      
      expect(result).toBe(true);
      
      const isBlacklisted = await tokenService.isTokenBlacklisted(token);
      expect(isBlacklisted).toBe(true);
    });
  });

  describe('Token Rotation', () => {
    test('should rotate tokens successfully', async () => {
      const payload = { id: testUser._id, role: testUser.role, email: testUser.email };
      const refreshToken = tokenService.generateRefreshToken(payload);
      
      // Add refresh token to user
      const refreshTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await testUser.addRefreshToken(refreshToken, refreshTokenExpiry);
      
      const result = await tokenService.rotateTokens(refreshToken);
      
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result).toHaveProperty('user');
      expect(result.user.id).toBe(testUser._id.toString());
      expect(result.refreshToken).not.toBe(refreshToken); // Should be different
    });

    test('should reject rotation with invalid refresh token', async () => {
      const invalidToken = 'invalid.refresh.token';
      
      await expect(tokenService.rotateTokens(invalidToken))
        .rejects.toThrow();
    });
  });

  describe('Token Revocation', () => {
    test('should revoke all user tokens', async () => {
      const payload = { id: testUser._id, role: testUser.role };
      const refreshToken1 = tokenService.generateRefreshToken(payload);
      const refreshToken2 = tokenService.generateRefreshToken(payload);
      
      // Add refresh tokens to user
      const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await testUser.addRefreshToken(refreshToken1, expiry);
      await testUser.addRefreshToken(refreshToken2, expiry);
      
      const revokedCount = await tokenService.revokeAllUserTokens(testUser._id);
      
      expect(revokedCount).toBe(2);
      
      // Check that tokens are blacklisted
      expect(await tokenService.isTokenBlacklisted(refreshToken1)).toBe(true);
      expect(await tokenService.isTokenBlacklisted(refreshToken2)).toBe(true);
      
      // Check that user has no refresh tokens
      const updatedUser = await User.findById(testUser._id);
      expect(updatedUser.refreshTokens).toHaveLength(0);
    });
  });

  describe('Token Statistics', () => {
    test('should get token statistics', async () => {
      const payload = { id: testUser._id, role: testUser.role };
      const token = tokenService.generateAccessToken(payload);
      
      await tokenService.blacklistToken(token, 'access', testUser._id);
      
      const stats = await tokenService.getTokenStats();
      
      expect(stats).toHaveProperty('blacklistedTokens');
      expect(stats).toHaveProperty('activeRefreshTokens');
      expect(stats.blacklistedTokens).toBeGreaterThan(0);
    });
  });
});