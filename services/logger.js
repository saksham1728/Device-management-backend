const winston = require('winston');
const path = require('path');

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define colors for each level
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

// Add colors to winston
winston.addColors(colors);

// Define log format
const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.prettyPrint()
);

// Define console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`
  )
);

// Define transports
const transports = [
  // Console transport
  new winston.transports.Console({
    format: process.env.NODE_ENV === 'development' ? consoleFormat : format,
    level: process.env.LOG_LEVEL || 'info'
  }),
  
  // File transport for errors
  new winston.transports.File({
    filename: path.join('logs', 'error.log'),
    level: 'error',
    format: format,
    maxsize: 5242880, // 5MB
    maxFiles: 5,
  }),
  
  // File transport for all logs
  new winston.transports.File({
    filename: path.join('logs', 'combined.log'),
    format: format,
    maxsize: 5242880, // 5MB
    maxFiles: 5,
  }),
  
  // File transport for security logs
  new winston.transports.File({
    filename: path.join('logs', 'security.log'),
    level: 'warn',
    format: format,
    maxsize: 5242880, // 5MB
    maxFiles: 10,
  })
];

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  levels,
  format,
  transports,
  exitOnError: false,
});

// Create specialized loggers
const securityLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
    winston.format.label({ label: 'SECURITY' })
  ),
  transports: [
    new winston.transports.File({
      filename: path.join('logs', 'security.log'),
      maxsize: 5242880,
      maxFiles: 10,
    }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

const auditLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
    winston.format.label({ label: 'AUDIT' })
  ),
  transports: [
    new winston.transports.File({
      filename: path.join('logs', 'audit.log'),
      maxsize: 5242880,
      maxFiles: 20,
    })
  ]
});

// Helper functions
const logSecurityEvent = (event, details = {}) => {
  securityLogger.warn('Security Event', {
    event,
    ...details,
    timestamp: new Date().toISOString()
  });
};

const logAuditEvent = (action, userId, details = {}) => {
  auditLogger.info('Audit Event', {
    action,
    userId,
    ...details,
    timestamp: new Date().toISOString()
  });
};

const logError = (error, context = {}) => {
  logger.error('Application Error', {
    message: error.message,
    stack: error.stack,
    ...context,
    timestamp: new Date().toISOString()
  });
};

const logInfo = (message, data = {}) => {
  logger.info(message, {
    ...data,
    timestamp: new Date().toISOString()
  });
};

const logWarning = (message, data = {}) => {
  logger.warn(message, {
    ...data,
    timestamp: new Date().toISOString()
  });
};

const logDebug = (message, data = {}) => {
  logger.debug(message, {
    ...data,
    timestamp: new Date().toISOString()
  });
};

// HTTP request logger middleware
const httpLogger = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logData = {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.clientIp || req.ip,
      userAgent: req.get('User-Agent'),
      userId: req.user ? req.user.id : null,
      requestId: req.requestId
    };
    
    if (res.statusCode >= 400) {
      logger.warn('HTTP Request', logData);
    } else {
      logger.http('HTTP Request', logData);
    }
  });
  
  next();
};

module.exports = {
  logger,
  securityLogger,
  auditLogger,
  logSecurityEvent,
  logAuditEvent,
  logError,
  logInfo,
  logWarning,
  logDebug,
  httpLogger
};