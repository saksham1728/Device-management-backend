const express = require('express');
const router = express.Router();
const metricsController = require('../controllers/metricsController');
const { auth } = require('../middlewares/auth');
const { analyticsRateLimiter, generalRateLimiter } = require('../middlewares/rateLimiter');

// Health check endpoint (public, no rate limiting)
router.get('/health', metricsController.getHealth);

// Metrics endpoints (require authentication with analytics rate limiting)
router.get('/metrics', auth, analyticsRateLimiter, metricsController.getMetrics);
router.get('/metrics/endpoint/:method/:endpoint', auth, analyticsRateLimiter, metricsController.getEndpointMetrics);

module.exports = router;