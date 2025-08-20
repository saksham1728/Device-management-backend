const mongoose = require('mongoose');

const exportJobSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  type: { 
    type: String, 
    enum: ['logs', 'usage_report', 'device_report'], 
    required: true 
  },
  status: { 
    type: String, 
    enum: ['pending', 'processing', 'completed', 'failed'], 
    default: 'pending' 
  },
  config: {
    format: { type: String, enum: ['csv', 'json'], default: 'csv' },
    dateRange: {
      startDate: { type: Date, required: true },
      endDate: { type: Date, required: true }
    },
    filters: {
      deviceIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Device' }],
      eventTypes: [String],
      includeInactive: { type: Boolean, default: false }
    }
  },
  result: {
    fileUrl: { type: String, default: null },
    fileName: { type: String, default: null },
    fileSize: { type: Number, default: 0 },
    recordCount: { type: Number, default: 0 },
    downloadCount: { type: Number, default: 0 }
  },
  progress: {
    percentage: { type: Number, default: 0 },
    currentStep: { type: String, default: 'queued' },
    processedRecords: { type: Number, default: 0 },
    totalRecords: { type: Number, default: 0 }
  },
  error: {
    message: { type: String, default: null },
    stack: { type: String, default: null },
    code: { type: String, default: null }
  },
  metadata: {
    estimatedDuration: { type: Number, default: null }, // in seconds
    priority: { type: Number, default: 0 },
    retryCount: { type: Number, default: 0 },
    maxRetries: { type: Number, default: 3 }
  },
  completedAt: { type: Date, default: null },
  expiresAt: { type: Date, default: null }, // When the file expires
  notificationSent: { type: Boolean, default: false }
}, { timestamps: true });

// Indexes for efficient querying
exportJobSchema.index({ userId: 1, createdAt: -1 });
exportJobSchema.index({ status: 1, createdAt: 1 });
exportJobSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Virtual for duration
exportJobSchema.virtual('duration').get(function() {
  if (this.completedAt && this.createdAt) {
    return Math.round((this.completedAt - this.createdAt) / 1000); // in seconds
  }
  return null;
});

// Method to mark as completed
exportJobSchema.methods.markCompleted = function(result) {
  this.status = 'completed';
  this.completedAt = new Date();
  this.progress.percentage = 100;
  this.progress.currentStep = 'completed';
  
  if (result) {
    this.result = { ...this.result, ...result };
  }
  
  // Set expiration date (7 days from completion)
  this.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  
  return this.save();
};

// Method to mark as failed
exportJobSchema.methods.markFailed = function(error) {
  this.status = 'failed';
  this.error = {
    message: error.message,
    stack: error.stack,
    code: error.code || 'EXPORT_ERROR'
  };
  this.metadata.retryCount += 1;
  
  return this.save();
};

// Method to update progress
exportJobSchema.methods.updateProgress = function(percentage, currentStep, processedRecords = null) {
  this.progress.percentage = Math.min(100, Math.max(0, percentage));
  this.progress.currentStep = currentStep;
  
  if (processedRecords !== null) {
    this.progress.processedRecords = processedRecords;
  }
  
  return this.save();
};

// Static method to clean expired jobs
exportJobSchema.statics.cleanExpired = async function() {
  const result = await this.deleteMany({ 
    expiresAt: { $lt: new Date() },
    status: 'completed'
  });
  return result.deletedCount;
};

module.exports = mongoose.model('ExportJob', exportJobSchema);