const bcrypt = require('bcryptjs');
const User = require('../models/user');
const tokenService = require('../services/tokenService');
const cacheService = require('../services/cacheService');

exports.signup = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    
    // Check if user already exists
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ 
        success: false, 
        error: {
          code: 'EMAIL_ALREADY_EXISTS',
          message: 'Email is already registered'
        }
      });
    }
    
    // Hash password
    const hashed = await bcrypt.hash(password, 12);
    
    // Create user
    const user = new User({ name, email, password: hashed, role });
    await user.save();
    
    res.status(201).json({ 
      success: true, 
      message: 'User registered successfully',
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role
        }
      }
    });
  } catch (err) {
    res.status(500).json({ 
      success: false, 
      error: {
        code: 'SIGNUP_ERROR',
        message: 'Failed to create user account',
        details: err.message
      }
    });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const userAgent = req.get('User-Agent');
    const ip = req.ip || req.connection.remoteAddress;
    
    // Find user and include password for comparison
    const user = await User.findOne({ email }).select('+password');
    
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password'
        }
      });
    }
    
    // Check if account is locked
    if (user.isLocked) {
      return res.status(423).json({ 
        success: false, 
        error: {
          code: 'ACCOUNT_LOCKED',
          message: 'Account is temporarily locked due to too many failed login attempts'
        }
      });
    }
    
    // Verify password
    const match = await bcrypt.compare(password, user.password);
    
    if (!match) {
      // Increment login attempts
      await user.incLoginAttempts();
      
      return res.status(401).json({ 
        success: false, 
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password'
        }
      });
    }
    
    // Reset login attempts on successful login
    await user.resetLoginAttempts();
    
    // Generate tokens
    const payload = { 
      id: user._id, 
      role: user.role,
      email: user.email 
    };
    
    const accessToken = tokenService.generateAccessToken(payload);
    const refreshToken = tokenService.generateRefreshToken(payload);
    
    // Store refresh token
    const refreshTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    await user.addRefreshToken(refreshToken, refreshTokenExpiry, userAgent, ip);
    
    // Invalidate user cache
    await cacheService.invalidatePattern(`user:${user._id}*`);
    
    res.json({
      success: true,
      message: 'Login successful',
      data: {
        accessToken,
        refreshToken,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          lastLoginAt: user.lastLoginAt
        }
      }
    });
  } catch (err) {
    res.status(500).json({ 
      success: false, 
      error: {
        code: 'LOGIN_ERROR',
        message: 'Login failed',
        details: err.message
      }
    });
  }
};

exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    const userAgent = req.get('User-Agent');
    const ip = req.ip || req.connection.remoteAddress;
    
    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_REFRESH_TOKEN',
          message: 'Refresh token is required'
        }
      });
    }
    
    // Rotate tokens
    const result = await tokenService.rotateTokens(refreshToken, userAgent, ip);
    
    res.json({
      success: true,
      message: 'Tokens refreshed successfully',
      data: result
    });
  } catch (error) {
    let statusCode = 401;
    let errorCode = 'REFRESH_TOKEN_ERROR';
    
    if (error.message.includes('expired')) {
      errorCode = 'REFRESH_TOKEN_EXPIRED';
    } else if (error.message.includes('invalid') || error.message.includes('not found')) {
      errorCode = 'INVALID_REFRESH_TOKEN';
    } else if (error.message.includes('locked')) {
      statusCode = 423;
      errorCode = 'ACCOUNT_LOCKED';
    }
    
    res.status(statusCode).json({
      success: false,
      error: {
        code: errorCode,
        message: error.message
      }
    });
  }
};

exports.logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    const userAgent = req.get('User-Agent');
    const ip = req.ip || req.connection.remoteAddress;
    
    // Get access token from header
    const accessToken = req.header('Authorization')?.replace('Bearer ', '');
    
    if (accessToken) {
      // Blacklist access token
      await tokenService.blacklistToken(
        accessToken, 
        'access', 
        req.user.id, 
        'logout', 
        userAgent, 
        ip
      );
    }
    
    if (refreshToken) {
      // Blacklist refresh token
      await tokenService.blacklistToken(
        refreshToken, 
        'refresh', 
        req.user.id, 
        'logout', 
        userAgent, 
        ip
      );
      
      // Remove refresh token from user
      const user = await User.findById(req.user.id);
      if (user) {
        await user.removeRefreshToken(refreshToken);
      }
    }
    
    // Invalidate user cache
    await cacheService.invalidatePattern(`user:${req.user.id}*`);
    
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'LOGOUT_ERROR',
        message: 'Logout failed',
        details: error.message
      }
    });
  }
};

exports.logoutAll = async (req, res) => {
  try {
    const userAgent = req.get('User-Agent');
    const ip = req.ip || req.connection.remoteAddress;
    
    // Get current access token
    const accessToken = req.header('Authorization')?.replace('Bearer ', '');
    
    if (accessToken) {
      // Blacklist current access token
      await tokenService.blacklistToken(
        accessToken, 
        'access', 
        req.user.id, 
        'logout_all', 
        userAgent, 
        ip
      );
    }
    
    // Revoke all user tokens
    const revokedCount = await tokenService.revokeAllUserTokens(req.user.id, 'logout_all');
    
    // Invalidate user cache
    await cacheService.invalidatePattern(`user:${req.user.id}*`);
    
    res.json({
      success: true,
      message: 'Logged out from all devices successfully',
      data: {
        revokedTokens: revokedCount
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'LOGOUT_ALL_ERROR',
        message: 'Failed to logout from all devices',
        details: error.message
      }
    });
  }
};

exports.revokeToken = async (req, res) => {
  try {
    const { token, type = 'refresh' } = req.body;
    const userAgent = req.get('User-Agent');
    const ip = req.ip || req.connection.remoteAddress;
    
    if (!token) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_TOKEN',
          message: 'Token is required'
        }
      });
    }
    
    // Blacklist the token
    const success = await tokenService.blacklistToken(
      token, 
      type, 
      req.user.id, 
      'revoked', 
      userAgent, 
      ip
    );
    
    if (type === 'refresh') {
      // Remove refresh token from user
      const user = await User.findById(req.user.id);
      if (user) {
        await user.removeRefreshToken(token);
      }
    }
    
    if (success) {
      res.json({
        success: true,
        message: `${type} token revoked successfully`
      });
    } else {
      res.status(500).json({
        success: false,
        error: {
          code: 'REVOKE_ERROR',
          message: 'Failed to revoke token'
        }
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'REVOKE_ERROR',
        message: 'Failed to revoke token',
        details: error.message
      }
    });
  }
};

