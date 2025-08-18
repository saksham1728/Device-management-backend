const Log = require('../models/log');
const Device = require('../models/device');

exports.createLog = async (req, res) => {
  try {
    const { event, value } = req.body;
    const device = await Device.findOne({ _id: req.params.id, owner_id: req.user.id });
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    const log = new Log({ device_id: device._id, event, value });
    await log.save();
    res.status(201).json({ success: true, log });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getLogs = async (req, res) => {
  try {
    const device = await Device.findOne({ _id: req.params.id, owner_id: req.user.id });
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    const limit = parseInt(req.query.limit) || 10;
    const logs = await Log.find({ device_id: device._id }).sort({ timestamp: -1 }).limit(limit);
    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getUsage = async (req, res) => {
  try {
    const device = await Device.findOne({ _id: req.params.id, owner_id: req.user.id });
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    let range = req.query.range || '24h';
    let ms = 24 * 60 * 60 * 1000;
    if (range.endsWith('h')) ms = parseInt(range) * 60 * 60 * 1000;
    const since = new Date(Date.now() - ms);
    const logs = await Log.find({
      device_id: device._id,
      event: 'units_consumed',
      timestamp: { $gte: since }
    });
    const total = logs.reduce((sum, l) => sum + l.value, 0);
    res.json({ success: true, device_id: device._id, total_units_last_24h: total });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

