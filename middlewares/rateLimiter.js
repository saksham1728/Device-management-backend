const rateLimit = require('express-rate-limit');
const config = require('../config');

const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: config.rateLimit,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { success: false, message: 'Too many requests, please try again later.' }
});

module.exports = limiter;

