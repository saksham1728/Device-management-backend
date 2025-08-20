require('dotenv').config();

module.exports = {
  port: process.env.PORT || 5000,
  mongoURI: process.env.MONGODB_URI,
  jwtSecret: process.env.JWT_SECRET,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
  rateLimit: parseInt(process.env.RATE_LIMIT) || 100,
  rateLimits: {
    auth: parseInt(process.env.AUTH_RATE_LIMIT) || 5,
    device: parseInt(process.env.DEVICE_RATE_LIMIT) || 100,
    analytics: parseInt(process.env.ANALYTICS_RATE_LIMIT) || 50,
    export: parseInt(process.env.EXPORT_RATE_LIMIT) || 10,
    general: parseInt(process.env.GENERAL_RATE_LIMIT) || 200
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || null,
    db: parseInt(process.env.REDIS_DB) || 0,
    retryDelayOnFailover: 100,
    maxRetriesPerRequest: 3,
  },
};

