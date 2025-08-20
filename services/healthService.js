const mongoose = require('mongoose');
const cacheService = require('./cacheService');

class HealthService {
  /**
   * Get overall system health status
   * @returns {Promise<Object>} - Health status object
   */
  async getHealthStatus() {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      dependencies: {}
    };

    // Check MongoDB connection
    try {
      health.dependencies.mongodb = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    } catch (error) {
      health.dependencies.mongodb = 'error';
      health.status = 'unhealthy';
    }

    // Check Redis connection
    try {
      health.dependencies.redis = await cacheService.getHealth();
    } catch (error) {
      health.dependencies.redis = 'error';
      health.status = 'unhealthy';
    }

    // Set overall status based on dependencies
    const hasUnhealthyDependency = Object.values(health.dependencies).some(
      status => status === 'disconnected' || status === 'error'
    );

    if (hasUnhealthyDependency) {
      health.status = 'unhealthy';
    }

    return health;
  }
}

module.exports = new HealthService();