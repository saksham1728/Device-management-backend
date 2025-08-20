const PerformanceMetrics = require('../models/performanceMetrics');

/**
 * Middleware to log API response times and performance metrics
 */
const performanceLogger = (req, res, next) => {
  const startTime = Date.now();
  
  // Store original end function
  const originalEnd = res.end;
  
  // Override res.end to capture response time
  res.end = function(chunk, encoding) {
    const responseTime = Date.now() - startTime;
    
    // Log performance metrics asynchronously to avoid blocking response
    setImmediate(async () => {
      try {
        const metrics = new PerformanceMetrics({
          endpoint: req.route ? req.route.path : req.path,
          method: req.method,
          responseTime,
          statusCode: res.statusCode,
          userId: req.user ? req.user.id : null,
          ip: req.ip || req.connection.remoteAddress,
          userAgent: req.get('User-Agent'),
          cacheHit: res.locals.cacheHit || false,
        });
        
        await metrics.save();
        
        // Log slow endpoints (> 1000ms)
        if (responseTime > 1000) {
          console.warn(`Slow endpoint detected: ${req.method} ${req.path} - ${responseTime}ms`);
        }
      } catch (error) {
        console.error('Error logging performance metrics:', error);
      }
    });
    
    // Add response time header
    res.set('X-Response-Time', `${responseTime}ms`);
    
    // Call original end function
    originalEnd.call(this, chunk, encoding);
  };
  
  next();
};

module.exports = performanceLogger;