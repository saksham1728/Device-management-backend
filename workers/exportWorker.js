const jobQueue = require('../services/jobQueue');
const exportService = require('../services/exportService');
const ExportJob = require('../models/exportJob');
const Device = require('../models/device');
const { logInfo, logError } = require('../services/logger');

class ExportWorker {
  constructor() {
    this.isRunning = false;
  }

  /**
   * Start the export worker
   */
  start() {
    if (this.isRunning) return;

    // Initialize job queue
    jobQueue.initialize();

    // Process export jobs
    const exportQueue = jobQueue.getQueue('export');
    exportQueue.process('process-export', 5, this.processExportJob.bind(this));

    // Process notification jobs
    const notificationQueue = jobQueue.getQueue('notification');
    notificationQueue.process('send-notification', 10, this.processNotificationJob.bind(this));

    // Process cleanup jobs
    const cleanupQueue = jobQueue.getQueue('cleanup');
    cleanupQueue.process('cleanup-task', 1, this.processCleanupJob.bind(this));

    this.isRunning = true;
    logInfo('Export worker started');
  }

  /**
   * Stop the export worker
   */
  async stop() {
    if (!this.isRunning) return;

    await jobQueue.close();
    this.isRunning = false;
    logInfo('Export worker stopped');
  }

  /**
   * Process export job
   * @param {Object} job - Bull job instance
   */
  async processExportJob(job) {
    const { jobId, userId, type, format, dateRange, filters } = job.data;
    
    try {
      logInfo('Processing export job', { jobId, userId, type });

      // Update job status
      const exportJob = await ExportJob.findById(jobId);
      if (!exportJob) {
        throw new Error('Export job not found');
      }

      exportJob.status = 'processing';
      await exportJob.save();

      // Get user devices for filtering
      const userDevices = await Device.find({ owner_id: userId });
      const deviceIds = userDevices.map(d => d._id);

      // Apply device filter
      if (!filters.deviceIds || filters.deviceIds.length === 0) {
        filters.deviceIds = deviceIds;
      } else {
        // Ensure user can only export their own devices
        filters.deviceIds = filters.deviceIds.filter(id => 
          deviceIds.some(deviceId => deviceId.toString() === id.toString())
        );
      }

      let result;
      
      // Process based on type
      switch (type) {
        case 'logs':
          result = await exportService.exportDeviceLogs({
            userId,
            format,
            dateRange,
            filters,
            jobId
          });
          break;
          
        case 'usage_report':
        case 'device_report':
          result = await exportService.generateUsageReport({
            userId,
            dateRange,
            filters,
            jobId
          });
          break;
          
        default:
          throw new Error(`Unknown export type: ${type}`);
      }

      // Mark job as completed
      await exportJob.markCompleted(result);

      // Queue notification job
      await jobQueue.addNotificationJob({
        userId,
        type: 'export_completed',
        jobId,
        exportType: type,
        fileName: result.filename,
        fileSize: result.fileSize,
        recordCount: result.recordCount
      });

      logInfo('Export job completed', { 
        jobId, 
        userId, 
        type, 
        recordCount: result.recordCount,
        fileSize: result.fileSize 
      });

      return result;

    } catch (error) {
      logError(error, { jobId, userId, type });

      // Mark job as failed
      const exportJob = await ExportJob.findById(jobId);
      if (exportJob) {
        await exportJob.markFailed(error);
      }

      // Queue failure notification
      await jobQueue.addNotificationJob({
        userId,
        type: 'export_failed',
        jobId,
        exportType: type,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * Process notification job
   * @param {Object} job - Bull job instance
   */
  async processNotificationJob(job) {
    const { userId, type, jobId, exportType, fileName, fileSize, recordCount, error } = job.data;
    
    try {
      logInfo('Processing notification job', { userId, type, jobId });

      // Simulate email notification (in real implementation, use email service)
      const notification = {
        userId,
        type,
        timestamp: new Date().toISOString(),
        data: {
          jobId,
          exportType,
          fileName,
          fileSize,
          recordCount,
          error
        }
      };

      // Log notification (simulate email sending)
      if (type === 'export_completed') {
        logInfo('Export completion notification sent', {
          userId,
          jobId,
          exportType,
          fileName,
          fileSize: this.formatFileSize(fileSize),
          recordCount
        });
        
        console.log(`📧 Email Notification Sent:
To: User ${userId}
Subject: Export Completed - ${exportType}
Message: Your ${exportType} export has been completed successfully.
File: ${fileName}
Size: ${this.formatFileSize(fileSize)}
Records: ${recordCount}
Download: Available in your exports section`);
      } else if (type === 'export_failed') {
        logError(new Error('Export failed notification'), {
          userId,
          jobId,
          exportType,
          error
        });
        
        console.log(`📧 Email Notification Sent:
To: User ${userId}
Subject: Export Failed - ${exportType}
Message: Your ${exportType} export has failed.
Error: ${error}
Please try again or contact support if the issue persists.`);
      }

      // Mark notification as sent in export job
      const exportJob = await ExportJob.findById(jobId);
      if (exportJob) {
        exportJob.notificationSent = true;
        await exportJob.save();
      }

      return notification;

    } catch (error) {
      logError(error, { userId, type, jobId });
      throw error;
    }
  }

  /**
   * Process cleanup job
   * @param {Object} job - Bull job instance
   */
  async processCleanupJob(job) {
    const { type, maxAge } = job.data;
    
    try {
      logInfo('Processing cleanup job', { type, maxAge });

      let cleanedCount = 0;

      switch (type) {
        case 'export_files':
          cleanedCount = await exportService.cleanOldExports(maxAge || 168); // 7 days
          break;
          
        case 'export_jobs':
          cleanedCount = await ExportJob.cleanExpired();
          break;
          
        case 'queue_jobs':
          // Clean completed jobs older than 24 hours
          const queues = ['export', 'notification', 'cleanup'];
          for (const queueName of queues) {
            const cleaned = await jobQueue.cleanQueue(queueName, 24 * 60 * 60 * 1000, 'completed');
            cleanedCount += cleaned;
          }
          break;
          
        default:
          throw new Error(`Unknown cleanup type: ${type}`);
      }

      logInfo('Cleanup job completed', { type, cleanedCount });
      return { type, cleanedCount };

    } catch (error) {
      logError(error, { type, maxAge });
      throw error;
    }
  }

  /**
   * Format file size for display
   * @param {number} bytes - File size in bytes
   * @returns {string} - Formatted file size
   */
  formatFileSize(bytes) {
    if (!bytes) return '0 B';
    
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
  }
}

module.exports = new ExportWorker();