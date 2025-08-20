const tokenService = require('../services/tokenService');
const User = require('../models/user');

/**
 * Authentication middleware
 */
const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'AUTH_ERROR',
          message: 'Access denied. No token provided.'
        }
      });
    }

    // Verify token using token service (includes blacklist check)
    const decoded = await tokenService.verifyToken(token, 'access');
    const user = await User.findById(decoded.id).select('-password -refreshTokens');
    
    if (!user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'AUTH_ERROR',
          message: 'Invalid token. User not found.'
        }
      });
    }

    // Check if user account is locked
    if (user.isLocked) {
      return res.status(423).json({
        success: false,
        error: {
          code: 'ACCOUNT_LOCKED',
          message: 'Account is temporarily locked.'
        }
      });
    }

    req.user = user;
    req.token = token; // Store token for potential blacklisting
    next();
  } catch (error) {
    let statusCode = 401;
    let errorCode = 'AUTH_ERROR';
    let message = 'Authentication failed';

    if (error.message.includes('expired')) {
      errorCode = 'TOKEN_EXPIRED';
      message = 'Token has expired';
    } else if (error.message.includes('revoked')) {
      errorCode = 'TOKEN_REVOKED';
      message = 'Token has been revoked';
    } else if (error.message.includes('invalid')) {
      errorCode = 'INVALID_TOKEN';
      message = 'Invalid token';
    }

    res.status(statusCode).json({
      success: false,
      error: {
        code: errorCode,
        message,
        details: error.message
      }
    });
  }
};

/**
 * Admin authorization middleware
 */
const adminAuth = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: {
        code: 'AUTHORIZATION_ERROR',
        message: 'Access denied. Admin privileges required.'
      }
    });
  }
  next();
};

module.exports = { auth, adminAuth };