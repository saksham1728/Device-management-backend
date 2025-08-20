const ExportJob = require('../models/exportJob');
const exportService = require('../services/exportService');
const jobQueue = require('../services/jobQueue');
const { exportRateLimiter } = require('../middlewares/rateLimiter');
const { logInfo, logError } = require('../services/logger');
const path = require('path');

/**
 * Create export job
 */
exports.createExportJob = async (req, res) => {
  try {
    const { type, format = 'csv', dateRange, filters = {} } = req.body;
    
    // Validate date range
    const startDate = new Date(dateRange.startDate);
    const endDate = new Date(dateRange.endDate);
    
    if (startDate >= endDate) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_DATE_RANGE',
          message: 'Start date must be before end date'
        }
      });
    }

    // Create export job
    const exportJob = new ExportJob({
      userId: req.user.id,
      type,
      config: {
        format,
        dateRange: { startDate, endDate },
        filters
      }
    });

    await exportJob.save();

    // Add job to queue
    await jobQueue.addExportJob({
      jobId: exportJob._id.toString(),
      userId: req.user.id,
      type,
      format,
      dateRange: { startDate, endDate },
      filters
    });

    logInfo('Export job created', {
      jobId: exportJob._id,
      userId: req.user.id,
      type,
      format
    });

    res.status(201).json({
      success: true,
      message: 'Export job created successfully',
      data: {
        jobId: exportJob._id,
        status: exportJob.status,
        type: exportJob.type,
        format: exportJob.config.format,
        createdAt: exportJob.createdAt
      }
    });

  } catch (error) {
    logError(error, { userId: req.user.id });
    res.status(500).json({
      success: false,
      error: {
        code: 'EXPORT_JOB_CREATION_ERROR',
        message: 'Failed to create export job',
        details: error.message
      }
    });
  }
};

/**
 * Get export job status
 */
exports.getJobStatus = async (req, res) => {
  try {
    const { jobId } = req.params;
    
    const job = await ExportJob.findOne({
      _id: jobId,
      userId: req.user.id
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'JOB_NOT_FOUND',
          message: 'Export job not found'
        }
      });
    }

    res.json({
      success: true,
      data: {
        jobId: job._id,
        status: job.status,
        type: job.type,
        progress: job.progress,
        result: job.result,
        error: job.error,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
        duration: job.duration
      }
    });

  } catch (error) {
    logError(error, { userId: req.user.id, jobId: req.params.jobId });
    res.status(500).json({
      success: false,
      error: {
        code: 'JOB_STATUS_ERROR',
        message: 'Failed to get job status',
        details: error.message
      }
    });
  }
};

/**
 * Get user's export jobs
 */
exports.getUserJobs = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, type } = req.query;
    const skip = (page - 1) * limit;

    const filter = { userId: req.user.id };
    if (status) filter.status = status;
    if (type) filter.type = type;

    const [jobs, total] = await Promise.all([
      ExportJob.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .select('-error.stack'), // Exclude stack trace from response
      ExportJob.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: {
        jobs,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalJobs: total,
          hasNext: skip + jobs.length < total,
          hasPrev: page > 1
        }
      }
    });

  } catch (error) {
    logError(error, { userId: req.user.id });
    res.status(500).json({
      success: false,
      error: {
        code: 'JOBS_FETCH_ERROR',
        message: 'Failed to fetch export jobs',
        details: error.message
      }
    });
  }
};

/**
 * Download export file
 */
exports.downloadExport = async (req, res) => {
  try {
    const { jobId } = req.params;
    
    const job = await ExportJob.findOne({
      _id: jobId,
      userId: req.user.id,
      status: 'completed'
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'EXPORT_NOT_FOUND',
          message: 'Export file not found or not ready'
        }
      });
    }

    if (!job.result.fileName) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'FILE_NOT_AVAILABLE',
          message: 'Export file is not available'
        }
      });
    }

    // Get file info
    const fileInfo = await exportService.getExportFile(job.result.fileName);
    
    // Increment download count
    job.result.downloadCount = (job.result.downloadCount || 0) + 1;
    await job.save();

    // Set appropriate headers
    const contentType = job.config.format === 'csv' ? 'text/csv' : 'application/json';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${job.result.fileName}"`);
    res.setHeader('Content-Length', fileInfo.size);

    // Stream file
    res.sendFile(fileInfo.filepath);

    logInfo('Export file downloaded', {
      jobId,
      userId: req.user.id,
      fileName: job.result.fileName,
      downloadCount: job.result.downloadCount
    });

  } catch (error) {
    logError(error, { userId: req.user.id, jobId: req.params.jobId });
    res.status(500).json({
      success: false,
      error: {
        code: 'DOWNLOAD_ERROR',
        message: 'Failed to download export file',
        details: error.message
      }
    });
  }
};

/**
 * Delete export job and file
 */
exports.deleteExportJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    
    const job = await ExportJob.findOne({
      _id: jobId,
      userId: req.user.id
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'JOB_NOT_FOUND',
          message: 'Export job not found'
        }
      });
    }

    // Delete file if it exists
    if (job.result.fileName) {
      try {
        await exportService.deleteExportFile(job.result.fileName);
      } catch (error) {
        // File might already be deleted, log but continue
        logError(error, { jobId, fileName: job.result.fileName });
      }
    }

    // Delete job record
    await ExportJob.findByIdAndDelete(jobId);

    logInfo('Export job deleted', {
      jobId,
      userId: req.user.id,
      type: job.type
    });

    res.json({
      success: true,
      message: 'Export job deleted successfully'
    });

  } catch (error) {
    logError(error, { userId: req.user.id, jobId: req.params.jobId });
    res.status(500).json({
      success: false,
      error: {
        code: 'DELETE_ERROR',
        message: 'Failed to delete export job',
        details: error.message
      }
    });
  }
};

/**
 * Get export statistics
 */
exports.getExportStats = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const stats = await ExportJob.aggregate([
      { $match: { userId: req.user._id } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalSize: { $sum: '$result.fileSize' },
          totalRecords: { $sum: '$result.recordCount' }
        }
      }
    ]);

    const summary = {
      total: 0,
      completed: 0,
      pending: 0,
      processing: 0,
      failed: 0,
      totalFileSize: 0,
      totalRecords: 0
    };

    stats.forEach(stat => {
      summary.total += stat.count;
      summary[stat._id] = stat.count;
      summary.totalFileSize += stat.totalSize || 0;
      summary.totalRecords += stat.totalRecords || 0;
    });

    res.json({
      success: true,
      data: summary
    });

  } catch (error) {
    logError(error, { userId: req.user.id });
    res.status(500).json({
      success: false,
      error: {
        code: 'STATS_ERROR',
        message: 'Failed to get export statistics',
        details: error.message
      }
    });
  }
};