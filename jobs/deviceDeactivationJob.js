const cron = require('node-cron');
const Device = require('../models/device');

cron.schedule('0 * * * *', async () => {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const result = await Device.updateMany(
    { last_active_at: { $lt: cutoff }, status: 'active' },
    { $set: { status: 'inactive' } }
  );
  if (result.modifiedCount > 0) {
    console.log(`Auto-deactivated ${result.modifiedCount} devices (inactive >24h)`);
  }
});

