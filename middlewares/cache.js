const cacheService = require('../services/cacheService');

/**
 * Cache middleware factory
 * @param {number} ttl - Time to live in seconds
 * @param {function} keyGenerator - Function to generate cache key
 * @returns {function} - Express middleware
 */
const cache = (ttl = 1800, keyGenerator = null) => {
  return async (req, res, next) => {
    try {
      // Generate cache key
      let cacheKey;
      if (keyGenerator && typeof keyGenerator === 'function') {
        cacheKey = keyGenerator(req);
      } else {
        // Default key generation
        const userId = req.user ? req.user._id || req.user.id : 'anonymous';
        const queryString = Object.keys(req.query).length > 0 ? JSON.stringify(req.query) : '';
        cacheKey = `${req.method}:${req.path}:${userId}:${queryString}`;
      }

      // Try to get from cache
      const cachedData = await cacheService.get(cacheKey);
      
      if (cachedData) {
        // Mark as cache hit for performance logging
        res.locals.cacheHit = true;
        return res.json(cachedData);
      }

      // Store original json method
      const originalJson = res.json;
      
      // Override json method to cache the response
      res.json = function(data) {
        // Only cache successful responses
        if (res.statusCode >= 200 && res.statusCode < 300) {
          // Cache asynchronously to avoid blocking response
          setImmediate(async () => {
            try {
              await cacheService.set(cacheKey, data, ttl);
            } catch (error) {
              console.error('Error caching response:', error);
            }
          });
        }
        
        // Call original json method
        originalJson.call(this, data);
      };

      // Store cache key for potential invalidation
      res.locals.cacheKey = cacheKey;
      res.locals.cacheHit = false;
      
      next();
    } catch (error) {
      console.error('Cache middleware error:', error);
      // Continue without caching on error
      next();
    }
  };
};

/**
 * Cache invalidation middleware
 * @param {string|function} pattern - Pattern to invalidate or function to generate patterns
 * @returns {function} - Express middleware
 */
const invalidateCache = (pattern) => {
  return async (req, res, next) => {
    // Store original json method
    const originalJson = res.json;
    
    // Override json method to invalidate cache after successful response
    res.json = function(data) {
      // Only invalidate on successful operations
      if (res.statusCode >= 200 && res.statusCode < 300) {
        setImmediate(async () => {
          try {
            let invalidationPattern;
            
            if (typeof pattern === 'function') {
              invalidationPattern = pattern(req, res, data);
            } else {
              invalidationPattern = pattern;
            }
            
            if (invalidationPattern) {
              await cacheService.invalidatePattern(invalidationPattern);
              console.log(`Cache invalidated for pattern: ${invalidationPattern}`);
            }
          } catch (error) {
            console.error('Error invalidating cache:', error);
          }
        });
      }
      
      // Call original json method
      originalJson.call(this, data);
    };
    
    next();
  };
};

/**
 * Device-specific cache key generator
 */
const deviceCacheKey = (req) => {
  const userId = req.user ? req.user._id || req.user.id : 'anonymous';
  const queryString = Object.keys(req.query).length > 0 ? JSON.stringify(req.query) : '';
  return `devices:${userId}:${queryString}`;
};

/**
 * User-specific cache key generator
 */
const userCacheKey = (req) => {
  const userId = req.user ? req.user._id || req.user.id : 'anonymous';
  return `user:${userId}`;
};

/**
 * Device cache invalidation pattern generator
 */
const deviceInvalidationPattern = (req) => {
  const userId = req.user ? req.user._id || req.user.id : 'anonymous';
  return `devices:${userId}:*`;
};

module.exports = {
  cache,
  invalidateCache,
  deviceCacheKey,
  userCacheKey,
  deviceInvalidationPattern
};