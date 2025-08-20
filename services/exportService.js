const fs = require('fs').promises;
const path = require('path');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const Log = require('../models/log');
const Device = require('../models/device');
const ExportJob = require('../models/exportJob');
const { logInfo, logError } = require('./logger');

class ExportService {
  constructor() {
    this.exportDir = path.join(process.cwd(), 'exports');
    this.ensureExportDirectory();
  }

  /**
   * Ensure export directory exists
   */
  async ensureExportDirectory() {
    try {
      await fs.access(this.exportDir);
    } catch (error) {
      await fs.mkdir(this.exportDir, { recursive: true });
      logInfo('Export directory created', { path: this.exportDir });
    }
  }

  /**
   * Export device logs
   * @param {Object} config - Export configuration
   * @returns {Promise<Object>} - Export result
   */
  async exportDeviceLogs(config) {
    const { userId, format, dateRange, filters, jobId } = config;
    
    try {
      // Update job progress
      if (jobId) {
        const job = await ExportJob.findById(jobId);
        if (job) await job.updateProgress(10, 'fetching_data');
      }

      // Build query
      const query = this.buildLogsQuery(userId, dateRange, filters);
      
      // Get total count for progress tracking
      const totalRecords = await Log.countDocuments(query);
      
      if (jobId) {
        const job = await ExportJob.findById(jobId);
        if (job) {
          job.progress.totalRecords = totalRecords;
          await job.updateProgress(20, 'processing_data');
        }
      }

      // Fetch data in batches
      const batchSize = 1000;
      let processedRecords = 0;
      let allLogs = [];

      for (let skip = 0; skip < totalRecords; skip += batchSize) {
        const batch = await Log.find(query)
          .populate('device_id', 'name type owner_id')
          .sort({ timestamp: -1 })
          .skip(skip)
          .limit(batchSize)
          .lean();

        allLogs = allLogs.concat(batch);
        processedRecords += batch.length;

        // Update progress
        if (jobId) {
          const progress = 20 + Math.floor((processedRecords / totalRecords) * 60);
          const job = await ExportJob.findById(jobId);
          if (job) await job.updateProgress(progress, 'processing_data', processedRecords);
        }
      }

      // Generate filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `device-logs-${timestamp}.${format}`;
      const filepath = path.join(this.exportDir, filename);

      // Export data
      let fileSize = 0;
      if (format === 'csv') {
        fileSize = await this.exportLogsToCSV(allLogs, filepath);
      } else {
        fileSize = await this.exportLogsToJSON(allLogs, filepath);
      }

      // Update final progress
      if (jobId) {
        const job = await ExportJob.findById(jobId);
        if (job) await job.updateProgress(100, 'completed');
      }

      logInfo('Device logs exported successfully', {
        userId,
        format,
        recordCount: allLogs.length,
        fileSize,
        filename
      });

      return {
        filename,
        filepath,
        fileSize,
        recordCount: allLogs.length,
        fileUrl: `/exports/${filename}`
      };

    } catch (error) {
      logError(error, { userId, format, jobId });
      throw error;
    }
  }

  /**
   * Generate usage report
   * @param {Object} config - Report configuration
   * @returns {Promise<Object>} - Report result
   */
  async generateUsageReport(config) {
    const { userId, dateRange, filters, jobId } = config;
    
    try {
      // Update job progress
      if (jobId) {
        const job = await ExportJob.findById(jobId);
        if (job) await job.updateProgress(10, 'analyzing_data');
      }

      // Get user devices
      const userDevices = await Device.find({ owner_id: userId });
      const deviceIds = userDevices.map(d => d._id);

      // Build aggregation pipeline
      const pipeline = [
        {
          $match: {
            device_id: { $in: deviceIds },
            timestamp: {
              $gte: new Date(dateRange.startDate),
              $lte: new Date(dateRange.endDate)
            }
          }
        },
        {
          $lookup: {
            from: 'devices',
            localField: 'device_id',
            foreignField: '_id',
            as: 'device'
          }
        },
        { $unwind: '$device' },
        {
          $group: {
            _id: {
              deviceId: '$device_id',
              deviceName: '$device.name',
              deviceType: '$device.type',
              event: '$event'
            },
            totalValue: { $sum: '$value' },
            count: { $sum: 1 },
            avgValue: { $avg: '$value' },
            maxValue: { $max: '$value' },
            minValue: { $min: '$value' },
            firstEvent: { $min: '$timestamp' },
            lastEvent: { $max: '$timestamp' }
          }
        },
        { $sort: { '_id.deviceName': 1, '_id.event': 1 } }
      ];

      const aggregationResults = await Log.aggregate(pipeline);

      // Update progress
      if (jobId) {
        const job = await ExportJob.findById(jobId);
        if (job) await job.updateProgress(50, 'generating_report');
      }

      // Process results into report format
      const deviceSummary = {};
      const eventSummary = {};
      let totalUsage = 0;
      let totalEvents = 0;

      aggregationResults.forEach(result => {
        const deviceId = result._id.deviceId.toString();
        const deviceName = result._id.deviceName;
        const deviceType = result._id.deviceType;
        const event = result._id.event;

        // Device summary
        if (!deviceSummary[deviceId]) {
          deviceSummary[deviceId] = {
            deviceId,
            deviceName,
            deviceType,
            totalUsage: 0,
            totalEvents: 0,
            events: {},
            firstActivity: result.firstEvent,
            lastActivity: result.lastEvent
          };
        }

        deviceSummary[deviceId].totalUsage += result.totalValue;
        deviceSummary[deviceId].totalEvents += result.count;
        deviceSummary[deviceId].events[event] = {
          totalValue: result.totalValue,
          count: result.count,
          avgValue: result.avgValue,
          maxValue: result.maxValue,
          minValue: result.minValue
        };

        // Update activity dates
        if (result.firstEvent < deviceSummary[deviceId].firstActivity) {
          deviceSummary[deviceId].firstActivity = result.firstEvent;
        }
        if (result.lastEvent > deviceSummary[deviceId].lastActivity) {
          deviceSummary[deviceId].lastActivity = result.lastEvent;
        }

        // Event summary
        if (!eventSummary[event]) {
          eventSummary[event] = {
            event,
            totalValue: 0,
            count: 0,
            deviceCount: 0,
            devices: new Set()
          };
        }

        eventSummary[event].totalValue += result.totalValue;
        eventSummary[event].count += result.count;
        eventSummary[event].devices.add(deviceId);
        eventSummary[event].deviceCount = eventSummary[event].devices.size;

        totalUsage += result.totalValue;
        totalEvents += result.count;
      });

      // Convert sets to arrays for JSON serialization
      Object.values(eventSummary).forEach(summary => {
        summary.devices = Array.from(summary.devices);
      });

      // Create report
      const report = {
        metadata: {
          generatedAt: new Date().toISOString(),
          userId,
          dateRange,
          totalDevices: Object.keys(deviceSummary).length,
          totalUsage,
          totalEvents
        },
        summary: {
          devices: Object.values(deviceSummary),
          events: Object.values(eventSummary)
        },
        charts: {
          deviceUsage: Object.values(deviceSummary).map(device => ({
            name: device.deviceName,
            value: device.totalUsage,
            events: device.totalEvents
          })),
          eventDistribution: Object.values(eventSummary).map(event => ({
            name: event.event,
            value: event.totalValue,
            count: event.count,
            devices: event.deviceCount
          }))
        }
      };

      // Generate filename and save
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `usage-report-${timestamp}.json`;
      const filepath = path.join(this.exportDir, filename);

      await fs.writeFile(filepath, JSON.stringify(report, null, 2));
      const stats = await fs.stat(filepath);

      // Update final progress
      if (jobId) {
        const job = await ExportJob.findById(jobId);
        if (job) await job.updateProgress(100, 'completed');
      }

      logInfo('Usage report generated successfully', {
        userId,
        deviceCount: Object.keys(deviceSummary).length,
        totalEvents,
        fileSize: stats.size,
        filename
      });

      return {
        filename,
        filepath,
        fileSize: stats.size,
        recordCount: totalEvents,
        fileUrl: `/exports/${filename}`
      };

    } catch (error) {
      logError(error, { userId, jobId });
      throw error;
    }
  }

  /**
   * Build logs query
   * @param {string} userId - User ID
   * @param {Object} dateRange - Date range
   * @param {Object} filters - Additional filters
   * @returns {Object} - MongoDB query
   */
  buildLogsQuery(userId, dateRange, filters = {}) {
    const query = {
      timestamp: {
        $gte: new Date(dateRange.startDate),
        $lte: new Date(dateRange.endDate)
      }
    };

    // Add device filter
    if (filters.deviceIds && filters.deviceIds.length > 0) {
      query.device_id = { $in: filters.deviceIds };
    } else {
      // Get all user devices
      query.device_id = { $in: [] }; // Will be populated with user's device IDs
    }

    // Add event type filter
    if (filters.eventTypes && filters.eventTypes.length > 0) {
      query.event = { $in: filters.eventTypes };
    }

    return query;
  }

  /**
   * Export logs to CSV
   * @param {Array} logs - Log data
   * @param {string} filepath - File path
   * @returns {Promise<number>} - File size
   */
  async exportLogsToCSV(logs, filepath) {
    const csvWriter = createCsvWriter({
      path: filepath,
      header: [
        { id: 'deviceName', title: 'Device Name' },
        { id: 'deviceType', title: 'Device Type' },
        { id: 'event', title: 'Event' },
        { id: 'value', title: 'Value' },
        { id: 'timestamp', title: 'Timestamp' },
        { id: 'deviceId', title: 'Device ID' }
      ]
    });

    const csvData = logs.map(log => ({
      deviceName: log.device_id?.name || 'Unknown',
      deviceType: log.device_id?.type || 'Unknown',
      event: log.event,
      value: log.value,
      timestamp: log.timestamp.toISOString(),
      deviceId: log.device_id?._id?.toString() || log.device_id
    }));

    await csvWriter.writeRecords(csvData);
    const stats = await fs.stat(filepath);
    return stats.size;
  }

  /**
   * Export logs to JSON
   * @param {Array} logs - Log data
   * @param {string} filepath - File path
   * @returns {Promise<number>} - File size
   */
  async exportLogsToJSON(logs, filepath) {
    const jsonData = {
      metadata: {
        exportedAt: new Date().toISOString(),
        recordCount: logs.length,
        format: 'json'
      },
      logs: logs.map(log => ({
        deviceId: log.device_id?._id?.toString() || log.device_id,
        deviceName: log.device_id?.name || 'Unknown',
        deviceType: log.device_id?.type || 'Unknown',
        event: log.event,
        value: log.value,
        timestamp: log.timestamp.toISOString()
      }))
    };

    await fs.writeFile(filepath, JSON.stringify(jsonData, null, 2));
    const stats = await fs.stat(filepath);
    return stats.size;
  }

  /**
   * Get export file
   * @param {string} filename - File name
   * @returns {Promise<Object>} - File info
   */
  async getExportFile(filename) {
    const filepath = path.join(this.exportDir, filename);
    
    try {
      await fs.access(filepath);
      const stats = await fs.stat(filepath);
      
      return {
        filepath,
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime
      };
    } catch (error) {
      throw new Error('Export file not found');
    }
  }

  /**
   * Delete export file
   * @param {string} filename - File name
   */
  async deleteExportFile(filename) {
    const filepath = path.join(this.exportDir, filename);
    
    try {
      await fs.unlink(filepath);
      logInfo('Export file deleted', { filename });
    } catch (error) {
      logError(error, { filename });
      throw error;
    }
  }

  /**
   * Clean old export files
   * @param {number} maxAgeHours - Maximum age in hours
   * @returns {Promise<number>} - Number of files deleted
   */
  async cleanOldExports(maxAgeHours = 168) { // 7 days default
    try {
      const files = await fs.readdir(this.exportDir);
      const cutoffTime = Date.now() - (maxAgeHours * 60 * 60 * 1000);
      let deletedCount = 0;

      for (const file of files) {
        const filepath = path.join(this.exportDir, file);
        const stats = await fs.stat(filepath);
        
        if (stats.mtime.getTime() < cutoffTime) {
          await fs.unlink(filepath);
          deletedCount++;
        }
      }

      logInfo('Old export files cleaned', { deletedCount, maxAgeHours });
      return deletedCount;
    } catch (error) {
      logError(error, { maxAgeHours });
      throw error;
    }
  }
}

module.exports = new ExportService();