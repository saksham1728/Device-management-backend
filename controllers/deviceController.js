const Device = require('../models/device');

exports.registerDevice = async (req, res) => {
  try {
    const { name, type, status } = req.body;
    const device = new Device({ name, type, status, owner_id: req.user.id });
    await device.save();
    res.status(201).json({ success: true, device });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.listDevices = async (req, res) => {
  try {
    const filter = { owner_id: req.user.id };
    if (req.query.type) filter.type = req.query.type;
    if (req.query.status) filter.status = req.query.status;
    const devices = await Device.find(filter);
    res.json({ success: true, devices });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.updateDevice = async (req, res) => {
  try {
    const device = await Device.findOneAndUpdate(
      { _id: req.params.id, owner_id: req.user.id },
      req.body,
      { new: true }
    );
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    res.json({ success: true, device });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.deleteDevice = async (req, res) => {
  try {
    const device = await Device.findOneAndDelete({ _id: req.params.id, owner_id: req.user.id });
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    res.json({ success: true, message: 'Device deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.heartbeat = async (req, res) => {
  try {
    const device = await Device.findOne({ _id: req.params.id, owner_id: req.user.id });
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    device.status = req.body.status;
    device.last_active_at = new Date();
    await device.save();
    res.json({ success: true, message: 'Device heartbeat recorded', last_active_at: device.last_active_at });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

