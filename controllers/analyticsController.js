const Log = require('../models/log');
const Device = require('../models/device');
const cacheService = require('../services/cacheService');

/**
 * Get comprehensive analytics dashboard data
 */
exports.getDashboard = async (req, res) => {
  try {
    const { range = '24h' } = req.query;
    const cacheKey = `analytics:${req.user.id}:dashboard:${range}`;
    
    // Try to get from cache first
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      res.locals.cacheHit = true;
      return res.json({ success: true, data: cached });
    }

    // Calculate time range
    let ms = 24 * 60 * 60 * 1000; // Default 24 hours
    if (range.endsWith('h')) {
      ms = parseInt(range) * 60 * 60 * 1000;
    } else if (range.endsWith('d')) {
      ms = parseInt(range) * 24 * 60 * 60 * 1000;
    }
    
    const since = new Date(Date.now() - ms);
    
    // Get user's devices
    const userDevices = await Device.find({ owner_id: req.user.id });
    const deviceIds = userDevices.map(d => d._id);
    
    if (deviceIds.length === 0) {
      const emptyData = {
        summary: {
          totalDevices: 0,
          activeDevices: 0,
          totalLogs: 0,
          totalUsage: 0
        },
        deviceBreakdown: [],
        usageTrend: [],
        eventDistribution: []
      };
      
      await cacheService.set(cacheKey, emptyData, 300); // Cache for 5 minutes
      return res.json({ success: true, data: emptyData });
    }

    // Run analytics queries in parallel
    const [
      totalLogs,
      recentLogs,
      usageData,
      eventDistribution,
      deviceActivity
    ] = await Promise.all([
      Log.countDocuments({ device_id: { $in: deviceIds } }),
      Log.countDocuments({ 
        device_id: { $in: deviceIds }, 
        timestamp: { $gte: since } 
      }),
      Log.aggregate([
        { $match: { device_id: { $in: deviceIds }, timestamp: { $gte: since } } },
        { $group: { _id: null, totalUsage: { $sum: '$value' } } }
      ]),
      Log.aggregate([
        { $match: { device_id: { $in: deviceIds }, timestamp: { $gte: since } } },
        { $group: { _id: '$event', count: { $sum: 1 }, totalValue: { $sum: '$value' } } },
        { $sort: { count: -1 } }
      ]),
      Log.aggregate([
        { $match: { device_id: { $in: deviceIds }, timestamp: { $gte: since } } },
        { $group: { 
          _id: '$device_id', 
          logCount: { $sum: 1 }, 
          totalUsage: { $sum: '$value' },
          lastActivity: { $max: '$timestamp' }
        }},
        { $lookup: {
          from: 'devices',
          localField: '_id',
          foreignField: '_id',
          as: 'device'
        }},
        { $unwind: '$device' },
        { $sort: { logCount: -1 } }
      ])
    ]);

    // Get usage trend data (hourly breakdown)
    const trendData = await Log.aggregate([
      { $match: { device_id: { $in: deviceIds }, timestamp: { $gte: since } } },
      { $group: {
        _id: {
          year: { $year: '$timestamp' },
          month: { $month: '$timestamp' },
          day: { $dayOfMonth: '$timestamp' },
          hour: { $hour: '$timestamp' }
        },
        usage: { $sum: '$value' },
        logCount: { $sum: 1 }
      }},
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1, '_id.hour': 1 } }
    ]);

    // Calculate active devices (devices with recent activity)
    const activeDevices = userDevices.filter(device => 
      device.last_active_at && device.last_active_at >= since
    ).length;

    const analytics = {
      summary: {
        totalDevices: userDevices.length,
        activeDevices,
        totalLogs,
        recentLogs,
        totalUsage: usageData[0]?.totalUsage || 0,
        range
      },
      deviceBreakdown: deviceActivity.map(item => ({
        deviceId: item._id,
        deviceName: item.device.name,
        deviceType: item.device.type,
        logCount: item.logCount,
        totalUsage: item.totalUsage,
        lastActivity: item.lastActivity
      })),
      usageTrend: trendData.map(item => ({
        timestamp: new Date(item._id.year, item._id.month - 1, item._id.day, item._id.hour),
        usage: item.usage,
        logCount: item.logCount
      })),
      eventDistribution: eventDistribution.map(item => ({
        event: item._id,
        count: item.count,
        totalValue: item.totalValue
      }))
    };

    // Cache for 5 minutes
    await cacheService.set(cacheKey, analytics, 300);
    
    res.json({ success: true, data: analytics });
  } catch (error) {
    console.error('Analytics dashboard error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ANALYTICS_ERROR',
        message: 'Failed to fetch analytics data',
        details: error.message
      }
    });
  }
};

/**
 * Get device comparison analytics
 */
exports.getDeviceComparison = async (req, res) => {
  try {
    const { range = '24h', devices } = req.query;
    const deviceIds = devices ? devices.split(',') : [];
    
    const cacheKey = `analytics:${req.user.id}:comparison:${range}:${deviceIds.join(',')}`;
    
    // Try to get from cache first
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      res.locals.cacheHit = true;
      return res.json({ success: true, data: cached });
    }

    // Calculate time range
    let ms = 24 * 60 * 60 * 1000;
    if (range.endsWith('h')) {
      ms = parseInt(range) * 60 * 60 * 1000;
    } else if (range.endsWith('d')) {
      ms = parseInt(range) * 24 * 60 * 60 * 1000;
    }
    
    const since = new Date(Date.now() - ms);
    
    // Get user's devices (filter by provided device IDs if specified)
    const deviceFilter = { owner_id: req.user.id };
    if (deviceIds.length > 0) {
      deviceFilter._id = { $in: deviceIds };
    }
    
    const userDevices = await Device.find(deviceFilter);
    const validDeviceIds = userDevices.map(d => d._id);

    if (validDeviceIds.length === 0) {
      return res.json({ 
        success: true, 
        data: { devices: [], comparison: [] } 
      });
    }

    // Get comparison data for each device
    const comparisonData = await Log.aggregate([
      { $match: { 
        device_id: { $in: validDeviceIds }, 
        timestamp: { $gte: since } 
      }},
      { $group: {
        _id: '$device_id',
        totalUsage: { $sum: '$value' },
        logCount: { $sum: 1 },
        avgUsage: { $avg: '$value' },
        maxUsage: { $max: '$value' },
        minUsage: { $min: '$value' },
        events: { $addToSet: '$event' }
      }},
      { $lookup: {
        from: 'devices',
        localField: '_id',
        foreignField: '_id',
        as: 'device'
      }},
      { $unwind: '$device' },
      { $sort: { totalUsage: -1 } }
    ]);

    const comparison = {
      devices: comparisonData.map(item => ({
        deviceId: item._id,
        deviceName: item.device.name,
        deviceType: item.device.type,
        metrics: {
          totalUsage: item.totalUsage,
          logCount: item.logCount,
          avgUsage: Math.round(item.avgUsage * 100) / 100,
          maxUsage: item.maxUsage,
          minUsage: item.minUsage,
          uniqueEvents: item.events.length
        }
      })),
      summary: {
        totalDevices: comparisonData.length,
        totalUsage: comparisonData.reduce((sum, item) => sum + item.totalUsage, 0),
        totalLogs: comparisonData.reduce((sum, item) => sum + item.logCount, 0),
        range
      }
    };

    // Cache for 5 minutes
    await cacheService.set(cacheKey, comparison, 300);
    
    res.json({ success: true, data: comparison });
  } catch (error) {
    console.error('Device comparison error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ANALYTICS_ERROR',
        message: 'Failed to fetch device comparison data',
        details: error.message
      }
    });
  }
};

/**
 * Get real-time analytics (minimal caching)
 */
exports.getRealTimeStats = async (req, res) => {
  try {
    const cacheKey = `analytics:${req.user.id}:realtime`;
    
    // Very short cache (30 seconds) for real-time data
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      res.locals.cacheHit = true;
      return res.json({ success: true, data: cached });
    }

    const userDevices = await Device.find({ owner_id: req.user.id });
    const deviceIds = userDevices.map(d => d._id);
    
    const now = new Date();
    const lastHour = new Date(now.getTime() - 60 * 60 * 1000);
    const last5Minutes = new Date(now.getTime() - 5 * 60 * 1000);

    const [recentActivity, currentHourLogs] = await Promise.all([
      Log.find({ 
        device_id: { $in: deviceIds }, 
        timestamp: { $gte: last5Minutes } 
      })
      .sort({ timestamp: -1 })
      .limit(10)
      .populate('device_id', 'name type'),
      
      Log.countDocuments({ 
        device_id: { $in: deviceIds }, 
        timestamp: { $gte: lastHour } 
      })
    ]);

    const realTimeStats = {
      activeDevices: userDevices.filter(d => d.status === 'active').length,
      recentActivity: recentActivity.map(log => ({
        deviceName: log.device_id.name,
        event: log.event,
        value: log.value,
        timestamp: log.timestamp
      })),
      currentHourLogs,
      lastUpdated: now
    };

    // Cache for 30 seconds
    await cacheService.set(cacheKey, realTimeStats, 30);
    
    res.json({ success: true, data: realTimeStats });
  } catch (error) {
    console.error('Real-time stats error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ANALYTICS_ERROR',
        message: 'Failed to fetch real-time statistics',
        details: error.message
      }
    });
  }
};