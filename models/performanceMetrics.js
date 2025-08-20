const mongoose = require('mongoose');

const performanceMetricsSchema = new mongoose.Schema({
  endpoint: { type: String, required: true },
  method: { type: String, required: true },
  responseTime: { type: Number, required: true }, // in milliseconds
  statusCode: { type: Number, required: true },
  timestamp: { type: Date, default: Date.now },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  ip: { type: String, required: true },
  userAgent: { type: String, default: null },
  cacheHit: { type: Boolean, default: false },
}, { timestamps: true });

// Index for efficient querying
performanceMetricsSchema.index({ endpoint: 1, timestamp: -1 });
performanceMetricsSchema.index({ timestamp: -1 });
performanceMetricsSchema.index({ userId: 1, timestamp: -1 });

module.exports = mongoose.model('PerformanceMetrics', performanceMetricsSchema);