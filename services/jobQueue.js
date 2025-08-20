const Queue = require('bull');
const config = require('../config');
const { logInfo, logError } = require('./logger');

class JobQueueService {
  constructor() {
    this.queues = new Map();
    this.isInitialized = false;
  }

  /**
   * Initialize job queues
   */
  initialize() {
    if (this.isInitialized) return;

    // Create export queue
    this.queues.set('export', new Queue('export jobs', {
      redis: config.redis,
      defaultJobOptions: {
        removeOnComplete: 10, // Keep last 10 completed jobs
        removeOnFail: 50, // Keep last 50 failed jobs
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      },
    }));

    // Create notification queue
    this.queues.set('notification', new Queue('notification jobs', {
      redis: config.redis,
      defaultJobOptions: {
        removeOnComplete: 5,
        removeOnFail: 20,
        attempts: 2,
        backoff: {
          type: 'fixed',
          delay: 5000,
        },
      },
    }));

    // Create cleanup queue
    this.queues.set('cleanup', new Queue('cleanup jobs', {
      redis: config.redis,
      defaultJobOptions: {
        removeOnComplete: 1,
        removeOnFail: 5,
        attempts: 1,
      },
    }));

    this.setupEventHandlers();
    this.isInitialized = true;

    logInfo('Job queues initialized');
  }

  /**
   * Setup event handlers for queues
   */
  setupEventHandlers() {
    this.queues.forEach((queue, name) => {
      queue.on('completed', (job, result) => {
        logInfo(`Job completed`, {
          queue: name,
          jobId: job.id,
          jobType: job.data.type,
          duration: Date.now() - job.timestamp
        });
      });

      queue.on('failed', (job, err) => {
        logError(new Error(`Job failed: ${err.message}`), {
          queue: name,
          jobId: job.id,
          jobType: job.data.type,
          attempts: job.attemptsMade,
          maxAttempts: job.opts.attempts
        });
      });

      queue.on('stalled', (job) => {
        logError(new Error('Job stalled'), {
          queue: name,
          jobId: job.id,
          jobType: job.data.type
        });
      });

      queue.on('error', (error) => {
        logError(error, { queue: name });
      });
    });
  }

  /**
   * Add export job to queue
   * @param {Object} jobData - Job data
   * @param {Object} options - Job options
   * @returns {Promise<Object>} - Job instance
   */
  async addExportJob(jobData, options = {}) {
    const queue = this.queues.get('export');
    if (!queue) throw new Error('Export queue not initialized');

    const defaultOptions = {
      priority: jobData.priority || 0,
      delay: options.delay || 0,
      attempts: options.attempts || 3,
    };

    const job = await queue.add('process-export', jobData, {
      ...defaultOptions,
      ...options
    });

    logInfo('Export job added to queue', {
      jobId: job.id,
      type: jobData.type,
      userId: jobData.userId
    });

    return job;
  }

  /**
   * Add notification job to queue
   * @param {Object} jobData - Job data
   * @param {Object} options - Job options
   * @returns {Promise<Object>} - Job instance
   */
  async addNotificationJob(jobData, options = {}) {
    const queue = this.queues.get('notification');
    if (!queue) throw new Error('Notification queue not initialized');

    const job = await queue.add('send-notification', jobData, options);

    logInfo('Notification job added to queue', {
      jobId: job.id,
      type: jobData.type,
      userId: jobData.userId
    });

    return job;
  }

  /**
   * Add cleanup job to queue
   * @param {Object} jobData - Job data
   * @param {Object} options - Job options
   * @returns {Promise<Object>} - Job instance
   */
  async addCleanupJob(jobData, options = {}) {
    const queue = this.queues.get('cleanup');
    if (!queue) throw new Error('Cleanup queue not initialized');

    const job = await queue.add('cleanup-task', jobData, options);

    logInfo('Cleanup job added to queue', {
      jobId: job.id,
      type: jobData.type
    });

    return job;
  }

  /**
   * Get job by ID
   * @param {string} queueName - Queue name
   * @param {string} jobId - Job ID
   * @returns {Promise<Object>} - Job instance
   */
  async getJob(queueName, jobId) {
    const queue = this.queues.get(queueName);
    if (!queue) throw new Error(`Queue ${queueName} not found`);

    return await queue.getJob(jobId);
  }

  /**
   * Get queue statistics
   * @param {string} queueName - Queue name
   * @returns {Promise<Object>} - Queue statistics
   */
  async getQueueStats(queueName) {
    const queue = this.queues.get(queueName);
    if (!queue) throw new Error(`Queue ${queueName} not found`);

    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaiting(),
      queue.getActive(),
      queue.getCompleted(),
      queue.getFailed(),
      queue.getDelayed()
    ]);

    return {
      name: queueName,
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      delayed: delayed.length,
      total: waiting.length + active.length + completed.length + failed.length + delayed.length
    };
  }

  /**
   * Get all queue statistics
   * @returns {Promise<Array>} - All queue statistics
   */
  async getAllQueueStats() {
    const stats = [];
    for (const queueName of this.queues.keys()) {
      const queueStats = await this.getQueueStats(queueName);
      stats.push(queueStats);
    }
    return stats;
  }

  /**
   * Pause queue
   * @param {string} queueName - Queue name
   */
  async pauseQueue(queueName) {
    const queue = this.queues.get(queueName);
    if (!queue) throw new Error(`Queue ${queueName} not found`);

    await queue.pause();
    logInfo(`Queue paused`, { queue: queueName });
  }

  /**
   * Resume queue
   * @param {string} queueName - Queue name
   */
  async resumeQueue(queueName) {
    const queue = this.queues.get(queueName);
    if (!queue) throw new Error(`Queue ${queueName} not found`);

    await queue.resume();
    logInfo(`Queue resumed`, { queue: queueName });
  }

  /**
   * Clean queue
   * @param {string} queueName - Queue name
   * @param {number} grace - Grace period in milliseconds
   * @param {string} type - Job type to clean
   */
  async cleanQueue(queueName, grace = 0, type = 'completed') {
    const queue = this.queues.get(queueName);
    if (!queue) throw new Error(`Queue ${queueName} not found`);

    const cleaned = await queue.clean(grace, type);
    logInfo(`Queue cleaned`, { 
      queue: queueName, 
      type, 
      cleaned: cleaned.length 
    });

    return cleaned.length;
  }

  /**
   * Close all queues
   */
  async close() {
    const closePromises = Array.from(this.queues.values()).map(queue => queue.close());
    await Promise.all(closePromises);
    
    this.queues.clear();
    this.isInitialized = false;
    
    logInfo('All job queues closed');
  }

  /**
   * Get queue instance
   * @param {string} queueName - Queue name
   * @returns {Object} - Queue instance
   */
  getQueue(queueName) {
    return this.queues.get(queueName);
  }
}

module.exports = new JobQueueService();