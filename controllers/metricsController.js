const metricsService = require('../services/metricsService');
const healthService = require('../services/healthService');

/**
 * Get system metrics
 */
exports.getMetrics = async (req, res) => {
  try {
    const { startDate, endDate, endpoint } = req.query;
    
    const options = {};
    if (startDate) options.startDate = new Date(startDate);
    if (endDate) options.endDate = new Date(endDate);
    if (endpoint) options.endpoint = endpoint;

    const metrics = await metricsService.getMetricsSummary(options);
    
    res.json({
      success: true,
      data: metrics
    });
  } catch (error) {
    console.error('Error getting metrics:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'METRICS_ERROR',
        message: 'Failed to retrieve metrics',
        details: error.message
      }
    });
  }
};

/**
 * Get endpoint-specific metrics
 */
exports.getEndpointMetrics = async (req, res) => {
  try {
    const { endpoint, method } = req.params;
    
    if (!endpoint || !method) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Endpoint and method are required'
        }
      });
    }

    const metrics = await metricsService.getEndpointMetrics(decodeURIComponent(endpoint), method.toUpperCase());
    
    res.json({
      success: true,
      data: metrics
    });
  } catch (error) {
    console.error('Error getting endpoint metrics:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'METRICS_ERROR',
        message: 'Failed to retrieve endpoint metrics',
        details: error.message
      }
    });
  }
};

/**
 * Get system health status
 */
exports.getHealth = async (req, res) => {
  try {
    const health = await healthService.getHealthStatus();
    
    const statusCode = health.status === 'healthy' ? 200 : 503;
    
    res.status(statusCode).json({
      success: health.status === 'healthy',
      data: health
    });
  } catch (error) {
    console.error('Error getting health status:', error);
    res.status(503).json({
      success: false,
      error: {
        code: 'HEALTH_CHECK_ERROR',
        message: 'Failed to retrieve health status',
        details: error.message
      }
    });
  }
};