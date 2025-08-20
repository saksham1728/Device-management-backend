const express = require('express');
const path = require('path');

// Import services
const { httpLogger } = require('./services/logger');
const performanceLogger = require('./middlewares/performanceLogger');

// Import security middleware
const {
  securityHeaders,
  cors,
  corsErrorHandler,
  ipTracking,
  additionalSecurityHeaders,
  structuredErrorResponse
} = require('./middlewares/security');

// Import routes
const authRoutes = require('./routes/authRoutes');
const deviceRoutes = require('./routes/deviceRoutes');
const logRoutes = require('./routes/logRoutes');
const userRoutes = require('./routes/userRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const metricsRoutes = require('./routes/metricsRoutes');
const exportRoutes = require('./routes/exportRoutes');
const sseRoutes = require('./routes/sseRoutes');

const app = express();

// Trust proxy for accurate IP addresses
app.set('trust proxy', 1);

// Security middleware
app.use(securityHeaders);
app.use(cors);
app.use(corsErrorHandler);
app.use(ipTracking);
app.use(additionalSecurityHeaders);

// Body parsing middleware
app.use(express.json({ limit: process.env.MAX_REQUEST_SIZE || '10mb' }));
app.use(express.urlencoded({ extended: true, limit: process.env.MAX_REQUEST_SIZE || '10mb' }));

// Logging middleware
app.use(httpLogger);
app.use(performanceLogger);

// Static files for exports
app.use('/exports', express.static(path.join(__dirname, 'exports')));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/devices/:id/logs', logRoutes);
app.use('/api/users', userRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/sse', sseRoutes);

// Health and metrics routes (no /api prefix for easier monitoring)
app.use('/', metricsRoutes);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'Endpoint not found',
      path: req.originalUrl,
      method: req.method,
      timestamp: new Date().toISOString(),
      requestId: req.requestId
    }
  });
});

// Global error handler
app.use(structuredErrorResponse);

module.exports = app;
