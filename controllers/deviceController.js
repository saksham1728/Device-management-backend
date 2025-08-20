const Device = require('../models/device');
const cacheService = require('../services/cacheService');
const realtimeService = require('../services/realtimeService');

exports.registerDevice = async (req, res) => {
  try {
    const { name, type, status } = req.body;
    const device = new Device({ name, type, status, owner_id: req.user.id });
    await device.save();
    
    // Invalidate device list cache for this user
    await cacheService.invalidatePattern(`devices:${req.user.id}:*`);
    
    res.status(201).json({ success: true, device });
  } catch (err) {
    res.status(500).json({ 
      success: false, 
      error: {
        code: 'DEVICE_CREATION_ERROR',
        message: 'Failed to register device',
        details: err.message
      }
    });
  }
};

exports.listDevices = async (req, res) => {
  try {
    const filter = { owner_id: req.user.id };
    if (req.query.type) filter.type = req.query.type;
    if (req.query.status) filter.status = req.query.status;
    
    const devices = await Device.find(filter).populate('owner_id', 'name email');
    res.json({ success: true, devices });
  } catch (err) {
    res.status(500).json({ 
      success: false, 
      error: {
        code: 'DEVICE_FETCH_ERROR',
        message: 'Failed to fetch devices',
        details: err.message
      }
    });
  }
};

exports.updateDevice = async (req, res) => {
  try {
    const device = await Device.findOneAndUpdate(
      { _id: req.params.id, owner_id: req.user.id },
      req.body,
      { new: true }
    );
    
    if (!device) {
      return res.status(404).json({ 
        success: false, 
        error: {
          code: 'DEVICE_NOT_FOUND',
          message: 'Device not found or access denied'
        }
      });
    }
    
    // Invalidate device list cache for this user
    await cacheService.invalidatePattern(`devices:${req.user.id}:*`);
    
    // Broadcast device update in real-time
    realtimeService.broadcastDeviceUpdate(device._id, device.status, req.user.id);
    
    res.json({ success: true, device });
  } catch (err) {
    res.status(500).json({ 
      success: false, 
      error: {
        code: 'DEVICE_UPDATE_ERROR',
        message: 'Failed to update device',
        details: err.message
      }
    });
  }
};

exports.deleteDevice = async (req, res) => {
  try {
    const device = await Device.findOneAndDelete({ _id: req.params.id, owner_id: req.user.id });
    
    if (!device) {
      return res.status(404).json({ 
        success: false, 
        error: {
          code: 'DEVICE_NOT_FOUND',
          message: 'Device not found or access denied'
        }
      });
    }
    
    // Invalidate device list cache for this user
    await cacheService.invalidatePattern(`devices:${req.user.id}:*`);
    
    res.json({ success: true, message: 'Device deleted successfully' });
  } catch (err) {
    res.status(500).json({ 
      success: false, 
      error: {
        code: 'DEVICE_DELETE_ERROR',
        message: 'Failed to delete device',
        details: err.message
      }
    });
  }
};

exports.heartbeat = async (req, res) => {
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
    
    device.status = req.body.status || device.status;
    device.last_active_at = new Date();
    await device.save();
    
    // Invalidate device list cache since status changed
    await cacheService.invalidatePattern(`devices:${req.user.id}:*`);
    
    // Broadcast heartbeat in real-time
    realtimeService.broadcastHeartbeat(device._id, device.last_active_at, req.user.id);
    
    res.json({ 
      success: true, 
      message: 'Device heartbeat recorded', 
      data: {
        deviceId: device._id,
        status: device.status,
        last_active_at: device.last_active_at
      }
    });
  } catch (err) {
    res.status(500).json({ 
      success: false, 
      error: {
        code: 'HEARTBEAT_ERROR',
        message: 'Failed to record heartbeat',
        details: err.message
      }
    });
  }
};

