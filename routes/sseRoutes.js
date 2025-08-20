const express = require('express');
const router = express.Router();
const sseService = require('../services/sseService');
const { generalRateLimiter } = require('../middlewares/rateLimiter');

/**
 * SSE endpoint for real-time updates
 */
router.get('/events', generalRateLimiter, (req, res) => {
  sseService.handleConnection(req, res);
});

/**
 * Get SSE connection statistics (admin only)
 */
router.get('/stats', (req, res) => {
  const stats = sseService.getConnectionStats();
  res.json({
    success: true,
    data: stats
  });
});

module.exports = router;