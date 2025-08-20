const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');
const { auth } = require('../middlewares/auth');
const { analyticsRateLimiter } = require('../middlewares/rateLimiter');
const { cache } = require('../middlewares/cache');
const validate = require('../middlewares/validate');
const Joi = require('joi');

// Validation schemas
const analyticsQuerySchema = Joi.object({
  range: Joi.string().pattern(/^\d+[hd]$/).default('24h'),
  devices: Joi.string().pattern(/^[a-fA-F0-9,]+$/) // Comma-separated device IDs
});

const dashboardQuerySchema = Joi.object({
  range: Joi.string().pattern(/^\d+[hd]$/).default('24h')
});

// Analytics cache key generators
const analyticsCacheKey = (req) => {
  const userId = req.user.id;
  const queryString = Object.keys(req.query).length > 0 ? JSON.stringify(req.query) : '';
  return `analytics:${userId}:${req.path}:${queryString}`;
};

// Apply authentication and analytics rate limiting to all routes
router.use(auth, analyticsRateLimiter);

// Dashboard analytics (5-minute cache)
router.get('/dashboard', 
  validate(dashboardQuerySchema, 'query'),
  cache(300, analyticsCacheKey), // 5 minutes
  analyticsController.getDashboard
);

// Device comparison analytics (5-minute cache)
router.get('/comparison', 
  validate(analyticsQuerySchema, 'query'),
  cache(300, analyticsCacheKey), // 5 minutes
  analyticsController.getDeviceComparison
);

// Real-time statistics (30-second cache)
router.get('/realtime', 
  cache(30, analyticsCacheKey), // 30 seconds
  analyticsController.getRealTimeStats
);

module.exports = router;