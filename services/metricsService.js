const PerformanceMetrics = require('../models/performanceMetrics');
const cacheService = require('./cacheService');

class MetricsService {
  /**
   * Get performance metrics summary
   * @param {Object} options - Query options
   * @returns {Promise<Object>} - Metrics summary
   */
  async getMetricsSummary(options = {}) {
    const cacheKey = `metrics:summary:${JSON.stringify(options)}`;
    
    // Try to get from cache first
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      return cached;
    }

    const {
      startDate = new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
      endDate = new Date(),
      endpoint = null
    } = options;

    const matchStage = {
      timestamp: { $gte: startDate, $lte: endDate }
    };

    if (endpoint) {
      matchStage.endpoint = endpoint;
    }

    try {
      // Get basic metrics
      const [totalRequests, avgResponseTime, statusCodeStats] = await Promise.all([
        PerformanceMetrics.countDocuments(matchStage),
        PerformanceMetrics.aggregate([
          { $match: matchStage },
          { $group: { _id: null, avgResponseTime: { $avg: '$responseTime' } } }
        ]),
        PerformanceMetrics.aggregate([
          { $match: matchStage },
          { $group: { _id: '$statusCode', count: { $sum: 1 } } },
          { $sort: { _id: 1 } }
        ])
      ]);

      // Get percentile data
      const responseTimePercentiles = await this.getResponseTimePercentiles(matchStage);
      
      // Get top slow endpoints
      const slowEndpoints = await PerformanceMetrics.aggregate([
        { $match: matchStage },
        { $group: { 
          _id: { endpoint: '$endpoint', method: '$method' },
          avgResponseTime: { $avg: '$responseTime' },
          count: { $sum: 1 }
        }},
        { $sort: { avgResponseTime: -1 } },
        { $limit: 10 }
      ]);

      // Get cache hit rate
      const cacheStats = await PerformanceMetrics.aggregate([
        { $match: matchStage },
        { $group: {
          _id: null,
          totalRequests: { $sum: 1 },
          cacheHits: { $sum: { $cond: ['$cacheHit', 1, 0] } }
        }}
      ]);

      const metrics = {
        requests: {
          total: totalRequests,
          last24h: totalRequests
        },
        responseTime: {
          avg: avgResponseTime[0]?.avgResponseTime || 0,
          p50: responseTimePercentiles.p50,
          p95: responseTimePercentiles.p95,
          p99: responseTimePercentiles.p99
        },
        statusCodes: statusCodeStats.reduce((acc, stat) => {
          acc[stat._id] = stat.count;
          return acc;
        }, {}),
        cache: {
          hitRate: cacheStats[0] ? (cacheStats[0].cacheHits / cacheStats[0].totalRequests) : 0,
          missRate: cacheStats[0] ? 1 - (cacheStats[0].cacheHits / cacheStats[0].totalRequests) : 1
        },
        slowEndpoints: slowEndpoints.map(endpoint => ({
          endpoint: `${endpoint._id.method} ${endpoint._id.endpoint}`,
          avgResponseTime: Math.round(endpoint.avgResponseTime),
          requestCount: endpoint.count
        }))
      };

      // Cache for 5 minutes
      await cacheService.set(cacheKey, metrics, 300);
      
      return metrics;
    } catch (error) {
      console.error('Error getting metrics summary:', error);
      throw error;
    }
  }

  /**
   * Get response time percentiles
   * @param {Object} matchStage - MongoDB match stage
   * @returns {Promise<Object>} - Percentile data
   */
  async getResponseTimePercentiles(matchStage) {
    try {
      const percentiles = await PerformanceMetrics.aggregate([
        { $match: matchStage },
        { $sort: { responseTime: 1 } },
        { $group: {
          _id: null,
          responseTimes: { $push: '$responseTime' },
          count: { $sum: 1 }
        }},
        { $project: {
          p50: { $arrayElemAt: ['$responseTimes', { $floor: { $multiply: ['$count', 0.5] } }] },
          p95: { $arrayElemAt: ['$responseTimes', { $floor: { $multiply: ['$count', 0.95] } }] },
          p99: { $arrayElemAt: ['$responseTimes', { $floor: { $multiply: ['$count', 0.99] } }] }
        }}
      ]);

      return percentiles[0] || { p50: 0, p95: 0, p99: 0 };
    } catch (error) {
      console.error('Error calculating percentiles:', error);
      return { p50: 0, p95: 0, p99: 0 };
    }
  }

  /**
   * Get endpoint-specific metrics
   * @param {string} endpoint - Endpoint path
   * @param {string} method - HTTP method
   * @returns {Promise<Object>} - Endpoint metrics
   */
  async getEndpointMetrics(endpoint, method) {
    const cacheKey = `metrics:endpoint:${method}:${endpoint}`;
    
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      const metrics = await PerformanceMetrics.aggregate([
        { $match: { endpoint, method, timestamp: { $gte: last24h } } },
        { $group: {
          _id: null,
          totalRequests: { $sum: 1 },
          avgResponseTime: { $avg: '$responseTime' },
          minResponseTime: { $min: '$responseTime' },
          maxResponseTime: { $max: '$responseTime' },
          errorCount: { $sum: { $cond: [{ $gte: ['$statusCode', 400] }, 1, 0] } }
        }}
      ]);

      const result = metrics[0] || {
        totalRequests: 0,
        avgResponseTime: 0,
        minResponseTime: 0,
        maxResponseTime: 0,
        errorCount: 0
      };

      result.errorRate = result.totalRequests > 0 ? result.errorCount / result.totalRequests : 0;

      // Cache for 2 minutes
      await cacheService.set(cacheKey, result, 120);
      
      return result;
    } catch (error) {
      console.error('Error getting endpoint metrics:', error);
      throw error;
    }
  }

  /**
   * Clean old metrics data
   * @param {number} daysToKeep - Number of days to keep
   */
  async cleanOldMetrics(daysToKeep = 30) {
    try {
      const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
      const result = await PerformanceMetrics.deleteMany({ timestamp: { $lt: cutoffDate } });
      console.log(`Cleaned ${result.deletedCount} old performance metrics records`);
      return result.deletedCount;
    } catch (error) {
      console.error('Error cleaning old metrics:', error);
      throw error;
    }
  }
}

module.exports = new MetricsService();