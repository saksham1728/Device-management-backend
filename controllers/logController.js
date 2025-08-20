const Log = require('../models/log');
const Device = require('../models/device');
const cacheService = require('../services/cacheService');

exports.createLog = async (req, res) => {
  try {
    const { event, value } = req.body;
    const device = await Device.findOne({ _id: req.params.id, owner_id: req.user.id });
    
    if (!device) {
      return res.status(404).json({ 
        success: false, 
        error: {
          code: 'DEVICE_NOT_FOUND',
          message: 'Device not found or access denied'
        }
      });
    }
    
    const log = new Log({ device_id: device._id, event, value });
    await log.save();
    
    // Invalidate analytics cache when new logs are created
    await cacheService.invalidatePattern(`analytics:${req.user.id}:*`);
    await cacheService.invalidatePattern(`logs:${device._id}:*`);
    
    res.status(201).json({ success: true, data: { log } });
  } catch (err) {
    res.status(500).json({ 
      success: false, 
      error: {
        code: 'LOG_CREATION_ERROR',
        message: 'Failed to create log entry',
        details: err.message
      }
    });
  }
};

exports.getLogs = async (req, res) => {
  try {
    const device = await Device.findOne({ _id: req.params.id, owner_id: req.user.id });
    
    if (!device) {
      return res.status(404).json({ 
        success: false, 
        error: {
          code: 'DEVICE_NOT_FOUND',
          message: 'Device not found or access denied'
        }
      });
    }
    
    const limit = parseInt(req.query.limit) || 10;
    const page = parseInt(req.query.page) || 1;
    const skip = (page - 1) * limit;
    
    const [logs, total] = await Promise.all([
      Log.find({ device_id: device._id })
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .populate('device_id', 'name type'),
      Log.countDocuments({ device_id: device._id })
    ]);
    
    res.json({ 
      success: true, 
      data: {
        logs,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalLogs: total,
          hasNext: skip + logs.length < total,
          hasPrev: page > 1
        }
      }
    });
  } catch (err) {
    res.status(500).json({ 
      success: false, 
      error: {
        code: 'LOGS_FETCH_ERROR',
        message: 'Failed to fetch logs',
        details: err.message
      }
    });
  }
};

exports.getUsage = async (req, res) => {
  try {
    const device = await Device.findOne({ _id: req.params.id, owner_id: req.user.id });
    
    if (!device) {
      return res.status(404).json({ 
        success: false, 
        error: {
          code: 'DEVICE_NOT_FOUND',
          message: 'Device not found or access denied'
        }
      });
    }
    
    let range = req.query.range || '24h';
    let ms = 24 * 60 * 60 * 1000;
    
    if (range.endsWith('h')) {
      ms = parseInt(range) * 60 * 60 * 1000;
    } else if (range.endsWith('d')) {
      ms = parseInt(range) * 24 * 60 * 60 * 1000;
    }
    
    const since = new Date(Date.now() - ms);
    
    const logs = await Log.find({
      device_id: device._id,
      event: 'units_consumed',
      timestamp: { $gte: since }
    }).sort({ timestamp: 1 });
    
    const total = logs.reduce((sum, l) => sum + l.value, 0);
    const average = logs.length > 0 ? total / logs.length : 0;
    
    // Group by hour for trend data
    const hourlyData = logs.reduce((acc, log) => {
      const hour = new Date(log.timestamp).getHours();
      if (!acc[hour]) acc[hour] = { hour, total: 0, count: 0 };
      acc[hour].total += log.value;
      acc[hour].count += 1;
      return acc;
    }, {});
    
    const trendData = Object.values(hourlyData).map(data => ({
      hour: data.hour,
      usage: data.total,
      average: data.total / data.count
    }));
    
    res.json({ 
      success: true, 
      data: {
        device_id: device._id,
        device_name: device.name,
        range,
        summary: {
          total_units: total,
          average_per_log: average,
          log_count: logs.length
        },
        trend: trendData
      }
    });
  } catch (err) {
    res.status(500).json({ 
      success: false, 
      error: {
        code: 'USAGE_FETCH_ERROR',
        message: 'Failed to fetch usage data',
        details: err.message
      }
    });
  }
};

