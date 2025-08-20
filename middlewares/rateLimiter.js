const rateLimit = require('express-rate-limit');
const config = require('../config');
const { logSecurityEvent } = require('../services/logger');

/**
 * Create rate limiter with custom configuration
 * @param {Object} options - Rate limiter options
 * @returns {Function} - Express middleware
 */
const createRateLimiter = (options = {}) => {
  const defaultOptions = {
    windowMs: 60 * 1000, // 1 minute
    max: config.rateLimit || 100,
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    keyGenerator: (req) => {
      // Use user ID if authenticated, otherwise use IP
      return req.user?.id || req.ip || req.connection.remoteAddress;
    },
    message: {
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests, please try again later.',
        retryAfter: Math.ceil(options.windowMs / 1000) || 60
      }
    },
    onLimitReached: (req, res, options) => {
      // Log rate limit violations for security monitoring
      logSecurityEvent('RATE_LIMIT_EXCEEDED', {
        ip: req.ip || req.connection.remoteAddress,
        userId: req.user?.id || null,
        userAgent: req.get('User-Agent'),
        endpoint: req.path,
        method: req.method,
        limit: options.max,
        windowMs: options.windowMs
      });
    },
    skip: (req, res) => {
      // Skip rate limiting for health checks
      return req.path === '/health' || req.path === '/metrics/health';
    }
  };

  return rateLimit({ ...defaultOptions, ...options });
};

/**
 * Authentication endpoints rate limiter (5 requests per minute)
 */
const authRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: parseInt(process.env.AUTH_RATE_LIMIT) || 5,
  message: {
    success: false,
    error: {
      code: 'AUTH_RATE_LIMIT_EXCEEDED',
      message: 'Too many authentication attempts, please try again later.',
      retryAfter: 60
    }
  },
  keyGenerator: (req) => {
    // For auth endpoints, use IP address to prevent abuse
    return req.ip || req.connection.remoteAddress;
  }
});

/**
 * Device operations rate limiter (100 requests per minute)
 */
const deviceRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: parseInt(process.env.DEVICE_RATE_LIMIT) || 100,
  message: {
    success: false,
    error: {
      code: 'DEVICE_RATE_LIMIT_EXCEEDED',
      message: 'Too many device operations, please try again later.',
      retryAfter: 60
    }
  }
});

/**
 * Analytics endpoints rate limiter (50 requests per minute)
 */
const analyticsRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: parseInt(process.env.ANALYTICS_RATE_LIMIT) || 50,
  message: {
    success: false,
    error: {
      code: 'ANALYTICS_RATE_LIMIT_EXCEEDED',
      message: 'Too many analytics requests, please try again later.',
      retryAfter: 60
    }
  }
});

/**
 * Export endpoints rate limiter (10 requests per hour)
 */
const exportRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: parseInt(process.env.EXPORT_RATE_LIMIT) || 10,
  message: {
    success: false,
    error: {
      code: 'EXPORT_RATE_LIMIT_EXCEEDED',
      message: 'Too many export requests, please try again later.',
      retryAfter: 3600
    }
  }
});

/**
 * General API rate limiter (200 requests per minute)
 */
const generalRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: parseInt(process.env.GENERAL_RATE_LIMIT) || 200,
  message: {
    success: false,
    error: {
      code: 'GENERAL_RATE_LIMIT_EXCEEDED',
      message: 'Too many requests, please try again later.',
      retryAfter: 60
    }
  }
});

/**
 * Strict rate limiter for sensitive operations (3 requests per minute)
 */
const strictRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 3,
  message: {
    success: false,
    error: {
      code: 'STRICT_RATE_LIMIT_EXCEEDED',
      message: 'Too many sensitive operations, please try again later.',
      retryAfter: 60
    }
  },
  keyGenerator: (req) => {
    // Use IP for strict limiting
    return req.ip || req.connection.remoteAddress;
  }
});

/**
 * Dynamic rate limiter based on user role
 */
const roleBasedRateLimiter = (req, res, next) => {
  const userRole = req.user?.role || 'user';
  
  let limiter;
  switch (userRole) {
    case 'admin':
      // Admins get higher limits
      limiter = createRateLimiter({
        windowMs: 60 * 1000,
        max: 500,
        message: {
          success: false,
          error: {
            code: 'ADMIN_RATE_LIMIT_EXCEEDED',
            message: 'Admin rate limit exceeded, please try again later.',
            retryAfter: 60
          }
        }
      });
      break;
    default:
      // Regular users get standard limits
      limiter = generalRateLimiter;
  }
  
  limiter(req, res, next);
};

// Legacy export for backward compatibility
const limiter = generalRateLimiter;

module.exports = {
  limiter, // Default limiter for backward compatibility
  createRateLimiter,
  authRateLimiter,
  deviceRateLimiter,
  analyticsRateLimiter,
  exportRateLimiter,
  generalRateLimiter,
  strictRateLimiter,
  roleBasedRateLimiter
};

