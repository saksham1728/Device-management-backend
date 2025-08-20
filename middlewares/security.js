const helmet = require('helmet');
const cors = require('cors');

/**
 * Security headers middleware using Helmet
 */
const securityHeaders = helmet({
  // Content Security Policy
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  
  // Cross Origin Embedder Policy
  crossOriginEmbedderPolicy: false,
  
  // DNS Prefetch Control
  dnsPrefetchControl: {
    allow: false
  },
  
  // Frame Options
  frameguard: {
    action: 'deny'
  },
  
  // Hide Powered By
  hidePoweredBy: true,
  
  // HTTP Strict Transport Security
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  },
  
  // IE No Open
  ieNoOpen: true,
  
  // No Sniff
  noSniff: true,
  
  // Origin Agent Cluster
  originAgentCluster: true,
  
  // Permitted Cross Domain Policies
  permittedCrossDomainPolicies: false,
  
  // Referrer Policy
  referrerPolicy: {
    policy: "no-referrer"
  },
  
  // X-XSS-Protection
  xssFilter: true
});

/**
 * CORS configuration
 */
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = process.env.ALLOWED_ORIGINS 
      ? process.env.ALLOWED_ORIGINS.split(',')
      : ['http://localhost:3000', 'http://localhost:3001'];
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'X-API-Key',
    'X-Request-ID'
  ],
  exposedHeaders: [
    'X-Response-Time',
    'X-Request-ID',
    'X-Rate-Limit-Limit',
    'X-Rate-Limit-Remaining',
    'X-Rate-Limit-Reset'
  ],
  maxAge: 86400 // 24 hours
};

/**
 * IP tracking and request logging middleware
 */
const ipTracking = (req, res, next) => {
  // Get real IP address
  const forwarded = req.headers['x-forwarded-for'];
  const realIp = req.headers['x-real-ip'];
  const cfConnectingIp = req.headers['cf-connecting-ip'];
  
  req.clientIp = cfConnectingIp || realIp || forwarded || req.connection.remoteAddress || req.socket.remoteAddress;
  
  // Generate unique request ID
  req.requestId = require('crypto').randomUUID();
  
  // Add request ID to response headers
  res.set('X-Request-ID', req.requestId);
  
  // Log request details
  const logData = {
    requestId: req.requestId,
    method: req.method,
    url: req.url,
    ip: req.clientIp,
    userAgent: req.get('User-Agent'),
    timestamp: new Date().toISOString(),
    userId: req.user ? req.user.id : null
  };
  
  // Store in request for later use
  req.logData = logData;
  
  // Log security-relevant requests
  if (req.path.includes('/auth/') || req.path.includes('/admin/')) {
    console.log('Security Request:', JSON.stringify(logData));
  }
  
  next();
};

/**
 * Request size limiter
 */
const requestSizeLimiter = (req, res, next) => {
  const maxSize = process.env.MAX_REQUEST_SIZE || '10mb';
  
  // This is handled by express.json() and express.urlencoded() middleware
  // but we can add custom logic here if needed
  next();
};

/**
 * Security response headers
 */
const additionalSecurityHeaders = (req, res, next) => {
  // Additional custom security headers
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    'X-Permitted-Cross-Domain-Policies': 'none',
    'Referrer-Policy': 'no-referrer',
    'X-Download-Options': 'noopen',
    'X-DNS-Prefetch-Control': 'off',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store'
  });
  
  next();
};

/**
 * Error handler for CORS errors
 */
const corsErrorHandler = (err, req, res, next) => {
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({
      success: false,
      error: {
        code: 'CORS_ERROR',
        message: 'Origin not allowed by CORS policy',
        requestId: req.requestId
      }
    });
  }
  next(err);
};

/**
 * Structured error response middleware
 */
const structuredErrorResponse = (err, req, res, next) => {
  // Default error response structure
  const errorResponse = {
    success: false,
    error: {
      code: err.code || 'INTERNAL_SERVER_ERROR',
      message: err.message || 'An unexpected error occurred',
      timestamp: new Date().toISOString(),
      requestId: req.requestId || 'unknown'
    }
  };
  
  // Add details in development mode
  if (process.env.NODE_ENV === 'development') {
    errorResponse.error.stack = err.stack;
    errorResponse.error.details = err.details;
  }
  
  // Log error
  console.error('Structured Error:', {
    ...errorResponse.error,
    url: req.url,
    method: req.method,
    ip: req.clientIp,
    userId: req.user ? req.user.id : null
  });
  
  // Determine status code
  let statusCode = err.statusCode || err.status || 500;
  
  // Handle specific error types
  if (err.name === 'ValidationError') {
    statusCode = 400;
    errorResponse.error.code = 'VALIDATION_ERROR';
  } else if (err.name === 'CastError') {
    statusCode = 400;
    errorResponse.error.code = 'INVALID_ID';
    errorResponse.error.message = 'Invalid ID format';
  } else if (err.code === 11000) {
    statusCode = 409;
    errorResponse.error.code = 'DUPLICATE_ENTRY';
    errorResponse.error.message = 'Duplicate entry detected';
  }
  
  res.status(statusCode).json(errorResponse);
};

module.exports = {
  securityHeaders,
  cors: cors(corsOptions),
  corsErrorHandler,
  ipTracking,
  requestSizeLimiter,
  additionalSecurityHeaders,
  structuredErrorResponse
};