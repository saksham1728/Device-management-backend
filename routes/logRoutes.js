const express = require('express');
const router = express.Router({ mergeParams: true });
const logController = require('../controllers/logController');
const { auth } = require('../middlewares/auth');
const { deviceRateLimiter, analyticsRateLimiter } = require('../middlewares/rateLimiter');
const { cache } = require('../middlewares/cache');
const validate = require('../middlewares/validate');
const Joi = require('joi');

// Validation schemas
const createLogSchema = Joi.object({
  event: Joi.string().required().min(2).max(100),
  value: Joi.number().required().min(0)
});

const getLogsQuerySchema = Joi.object({
  limit: Joi.number().integer().min(1).max(100).default(10),
  page: Joi.number().integer().min(1).default(1)
});

const usageQuerySchema = Joi.object({
  range: Joi.string().pattern(/^\d+[hd]$/).default('24h')
});

// Log cache key generator
const logCacheKey = (req) => {
  const deviceId = req.params.id;
  const queryString = Object.keys(req.query).length > 0 ? JSON.stringify(req.query) : '';
  return `logs:${deviceId}:${queryString}`;
};

// Usage cache key generator
const usageCacheKey = (req) => {
  const deviceId = req.params.id;
  const range = req.query.range || '24h';
  return `usage:${deviceId}:${range}`;
};

// Apply auth to all routes
router.use(auth);

// Log routes with appropriate rate limiting
router.post('/', 
  deviceRateLimiter, // Device operations rate limit for creating logs
  validate(createLogSchema), 
  logController.createLog
);

router.get('/', 
  analyticsRateLimiter, // Analytics rate limit for reading logs
  validate(getLogsQuerySchema, 'query'),
  cache(300, logCacheKey), // Cache for 5 minutes
  logController.getLogs
);

router.get('/usage', 
  analyticsRateLimiter, // Analytics rate limit for usage data
  validate(usageQuerySchema, 'query'),
  cache(300, usageCacheKey), // Cache for 5 minutes
  logController.getUsage
);

module.exports = router;

