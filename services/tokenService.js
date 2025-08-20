const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config');
const TokenBlacklist = require('../models/tokenBlacklist');
const User = require('../models/user');

class TokenService {
  /**
   * Generate access token (15 minutes)
   * @param {Object} payload - Token payload
   * @returns {string} - JWT access token
   */
  generateAccessToken(payload) {
    return jwt.sign(payload, config.jwtSecret, { 
      expiresIn: '15m',
      issuer: 'device-management-api',
      audience: 'device-management-client'
    });
  }

  /**
   * Generate refresh token (7 days)
   * @param {Object} payload - Token payload
   * @returns {string} - JWT refresh token
   */
  generateRefreshToken(payload) {
    return jwt.sign(payload, config.jwtSecret, { 
      expiresIn: '7d',
      issuer: 'device-management-api',
      audience: 'device-management-client'
    });
  }

  /**
   * Generate secure random refresh token
   * @returns {string} - Random token
   */
  generateSecureRefreshToken() {
    return crypto.randomBytes(64).toString('hex');
  }

  /**
   * Verify token
   * @param {string} token - Token to verify
   * @param {string} type - Token type ('access' or 'refresh')
   * @returns {Promise<Object>} - Decoded token payload
   */
  async verifyToken(token, type = 'access') {
    try {
      // Check if token is blacklisted
      const isBlacklisted = await TokenBlacklist.isBlacklisted(token);
      if (isBlacklisted) {
        throw new Error('Token has been revoked');
      }

      const decoded = jwt.verify(token, config.jwtSecret, {
        issuer: 'device-management-api',
        audience: 'device-management-client'
      });

      // Additional validation for refresh tokens
      if (type === 'refresh') {
        const user = await User.findById(decoded.id);
        if (!user) {
          throw new Error('User not found');
        }

        // Check if refresh token exists in user's token list
        const hasValidRefreshToken = user.refreshTokens.some(
          rt => rt.token === token && rt.expiresAt > new Date()
        );

        if (!hasValidRefreshToken) {
          throw new Error('Invalid refresh token');
        }

        // Update last used timestamp
        const refreshToken = user.refreshTokens.find(rt => rt.token === token);
        if (refreshToken) {
          refreshToken.lastUsed = new Date();
          await user.save();
        }
      }

      return decoded;
    } catch (error) {
      if (error.name === 'JsonWebTokenError') {
        throw new Error('Invalid token');
      }
      if (error.name === 'TokenExpiredError') {
        throw new Error('Token expired');
      }
      throw error;
    }
  }

  /**
   * Blacklist token
   * @param {string} token - Token to blacklist
   * @param {string} type - Token type
   * @param {string} userId - User ID
   * @param {string} reason - Reason for blacklisting
   * @param {string} userAgent - User agent
   * @param {string} ip - IP address
   * @returns {Promise<boolean>} - Success status
   */
  async blacklistToken(token, type, userId, reason = 'logout', userAgent = null, ip = null) {
    try {
      const decoded = jwt.decode(token);
      if (!decoded || !decoded.exp) {
        throw new Error('Invalid token format');
      }

      const expiresAt = new Date(decoded.exp * 1000);
      
      await TokenBlacklist.blacklistToken(
        token, 
        type, 
        userId, 
        expiresAt, 
        reason, 
        userAgent, 
        ip
      );

      return true;
    } catch (error) {
      console.error('Error blacklisting token:', error);
      return false;
    }
  }

  /**
   * Check if token is blacklisted
   * @param {string} token - Token to check
   * @returns {Promise<boolean>} - Blacklist status
   */
  async isTokenBlacklisted(token) {
    return await TokenBlacklist.isBlacklisted(token);
  }

  /**
   * Rotate tokens (generate new access and refresh tokens)
   * @param {string} refreshToken - Current refresh token
   * @param {string} userAgent - User agent
   * @param {string} ip - IP address
   * @returns {Promise<Object>} - New tokens and user data
   */
  async rotateTokens(refreshToken, userAgent = null, ip = null) {
    try {
      // Verify refresh token
      const decoded = await this.verifyToken(refreshToken, 'refresh');
      
      // Get user
      const user = await User.findById(decoded.id).select('-password');
      if (!user) {
        throw new Error('User not found');
      }

      // Check if user account is locked
      if (user.isLocked) {
        throw new Error('Account is temporarily locked');
      }

      // Generate new tokens
      const payload = { 
        id: user._id, 
        role: user.role,
        email: user.email 
      };
      
      const newAccessToken = this.generateAccessToken(payload);
      const newRefreshToken = this.generateRefreshToken(payload);

      // Blacklist old refresh token
      await this.blacklistToken(
        refreshToken, 
        'refresh', 
        user._id, 
        'rotated', 
        userAgent, 
        ip
      );

      // Remove old refresh token from user
      await user.removeRefreshToken(refreshToken);

      // Add new refresh token to user
      const refreshTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
      await user.addRefreshToken(newRefreshToken, refreshTokenExpiry, userAgent, ip);

      return {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role
        }
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Revoke all user tokens
   * @param {string} userId - User ID
   * @param {string} reason - Reason for revocation
   * @returns {Promise<number>} - Number of tokens revoked
   */
  async revokeAllUserTokens(userId, reason = 'security') {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      let revokedCount = 0;

      // Blacklist all refresh tokens
      for (const refreshToken of user.refreshTokens) {
        await this.blacklistToken(
          refreshToken.token, 
          'refresh', 
          userId, 
          reason
        );
        revokedCount++;
      }

      // Clear all refresh tokens from user
      user.refreshTokens = [];
      await user.save();

      return revokedCount;
    } catch (error) {
      console.error('Error revoking user tokens:', error);
      throw error;
    }
  }

  /**
   * Clean expired tokens from database
   * @returns {Promise<number>} - Number of tokens cleaned
   */
  async cleanExpiredTokens() {
    try {
      // Clean expired blacklisted tokens
      const blacklistCleaned = await TokenBlacklist.cleanExpired();
      
      // Clean expired refresh tokens from users
      const users = await User.find({ 'refreshTokens.0': { $exists: true } });
      let userTokensCleaned = 0;
      
      for (const user of users) {
        const originalCount = user.refreshTokens.length;
        await user.cleanExpiredTokens();
        const newCount = user.refreshTokens.length;
        userTokensCleaned += (originalCount - newCount);
      }

      console.log(`Cleaned ${blacklistCleaned} blacklisted tokens and ${userTokensCleaned} expired refresh tokens`);
      return blacklistCleaned + userTokensCleaned;
    } catch (error) {
      console.error('Error cleaning expired tokens:', error);
      throw error;
    }
  }

  /**
   * Get token statistics
   * @returns {Promise<Object>} - Token statistics
   */
  async getTokenStats() {
    try {
      const [blacklistedCount, activeRefreshTokens] = await Promise.all([
        TokenBlacklist.countDocuments(),
        User.aggregate([
          { $unwind: '$refreshTokens' },
          { $match: { 'refreshTokens.expiresAt': { $gt: new Date() } } },
          { $count: 'total' }
        ])
      ]);

      return {
        blacklistedTokens: blacklistedCount,
        activeRefreshTokens: activeRefreshTokens[0]?.total || 0
      };
    } catch (error) {
      console.error('Error getting token stats:', error);
      throw error;
    }
  }
}

module.exports = new TokenService();