const mongoose = require('mongoose');
const { logInfo, logError } = require('./logger');

class DatabaseService {
  constructor() {
    this.connectionPool = null;
    this.queryMetrics = new Map();
  }

  /**
   * Initialize database with optimizations
   */
  async initialize() {
    try {
      // Configure connection pool
      const connectionOptions = {
        maxPoolSize: parseInt(process.env.DB_MAX_POOL_SIZE) || 10,
        minPoolSize: parseInt(process.env.DB_MIN_POOL_SIZE) || 2,
        maxIdleTimeMS: parseInt(process.env.DB_MAX_IDLE_TIME) || 30000,
        serverSelectionTimeoutMS: parseInt(process.env.DB_SERVER_SELECTION_TIMEOUT) || 5000,
        socketTimeoutMS: parseInt(process.env.DB_SOCKET_TIMEOUT) || 45000,
        bufferMaxEntries: 0,
        bufferCommands: false,
      };

      // Apply connection options
      mongoose.set('strictQuery', false);
      
      // Monitor connection events
      mongoose.connection.on('connected', () => {
        logInfo('Database connected with optimized pool settings');
      });

      mongoose.connection.on('error', (error) => {
        logError(error, { context: 'Database connection error' });
      });

      mongoose.connection.on('disconnected', () => {
        logInfo('Database disconnected');
      });

      // Create indexes
      await this.createIndexes();
      
      logInfo('Database service initialized with optimizations');
    } catch (error) {
      logError(error, { context: 'Database initialization' });
      throw error;
    }
  }

  /**
   * Create database indexes for performance
   */
  async createIndexes() {
    try {
      const db = mongoose.connection.db;
      
      // User indexes
      await db.collection('users').createIndex({ email: 1 }, { unique: true });
      await db.collection('users').createIndex({ 'refreshTokens.token': 1 });
      await db.collection('users').createIndex({ 'refreshTokens.expiresAt': 1 });
      await db.collection('users').createIndex({ lastLoginAt: -1 });

      // Device indexes
      await db.collection('devices').createIndex({ owner_id: 1, status: 1 });
      await db.collection('devices').createIndex({ owner_id: 1, type: 1 });
      await db.collection('devices').createIndex({ last_active_at: -1 });
      await db.collection('devices').createIndex({ createdAt: -1 });

      // Log indexes
      await db.collection('logs').createIndex({ device_id: 1, timestamp: -1 });
      await db.collection('logs').createIndex({ device_id: 1, event: 1, timestamp: -1 });
      await db.collection('logs').createIndex({ timestamp: -1 });
      await db.collection('logs').createIndex({ event: 1, timestamp: -1 });

      // Performance metrics indexes
      await db.collection('performancemetrics').createIndex({ endpoint: 1, timestamp: -1 });
      await db.collection('performancemetrics').createIndex({ userId: 1, timestamp: -1 });
      await db.collection('performancemetrics').createIndex({ timestamp: -1 });

      // Export job indexes
      await db.collection('exportjobs').createIndex({ userId: 1, createdAt: -1 });
      await db.collection('exportjobs').createIndex({ status: 1, createdAt: 1 });
      await db.collection('exportjobs').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

      // Token blacklist indexes
      await db.collection('tokenblacklists').createIndex({ token: 1 }, { unique: true });
      await db.collection('tokenblacklists').createIndex({ userId: 1, blacklistedAt: -1 });
      await db.collection('tokenblacklists').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

      logInfo('Database indexes created successfully');
    } catch (error) {
      logError(error, { context: 'Index creation' });
      throw error;
    }
  }

  /**
   * Monitor query performance
   * @param {string} operation - Operation name
   * @param {Function} queryFunction - Query function to monitor
   * @returns {Promise<any>} - Query result
   */
  async monitorQuery(operation, queryFunction) {
    const startTime = Date.now();
    
    try {
      const result = await queryFunction();
      const duration = Date.now() - startTime;
      
      // Track query metrics
      if (!this.queryMetrics.has(operation)) {
        this.queryMetrics.set(operation, {
          count: 0,
          totalTime: 0,
          avgTime: 0,
          maxTime: 0,
          minTime: Infinity
        });
      }
      
      const metrics = this.queryMetrics.get(operation);
      metrics.count++;
      metrics.totalTime += duration;
      metrics.avgTime = metrics.totalTime / metrics.count;
      metrics.maxTime = Math.max(metrics.maxTime, duration);
      metrics.minTime = Math.min(metrics.minTime, duration);
      
      // Log slow queries
      if (duration > 1000) {
        logInfo('Slow query detected', {
          operation,
          duration: `${duration}ms`,
          threshold: '1000ms'
        });
      }
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logError(error, {
        operation,
        duration: `${duration}ms`,
        context: 'Query monitoring'
      });
      throw error;
    }
  }

  /**
   * Get query performance metrics
   * @returns {Object} - Performance metrics
   */
  getQueryMetrics() {
    const metrics = {};
    
    this.queryMetrics.forEach((data, operation) => {
      metrics[operation] = {
        ...data,
        avgTime: Math.round(data.avgTime * 100) / 100,
        maxTime: data.maxTime,
        minTime: data.minTime === Infinity ? 0 : data.minTime
      };
    });
    
    return metrics;
  }

  /**
   * Get database health status
   * @returns {Promise<Object>} - Health status
   */
  async getHealthStatus() {
    try {
      const db = mongoose.connection.db;
      const admin = db.admin();
      
      // Get server status
      const serverStatus = await admin.serverStatus();
      
      // Get database stats
      const dbStats = await db.stats();
      
      // Get connection info
      const connectionStatus = {
        readyState: mongoose.connection.readyState,
        host: mongoose.connection.host,
        port: mongoose.connection.port,
        name: mongoose.connection.name
      };
      
      return {
        status: mongoose.connection.readyState === 1 ? 'healthy' : 'unhealthy',
        connection: connectionStatus,
        server: {
          version: serverStatus.version,
          uptime: serverStatus.uptime,
          connections: serverStatus.connections
        },
        database: {
          collections: dbStats.collections,
          dataSize: dbStats.dataSize,
          indexSize: dbStats.indexSize,
          storageSize: dbStats.storageSize
        },
        performance: this.getQueryMetrics()
      };
    } catch (error) {
      logError(error, { context: 'Database health check' });
      return {
        status: 'unhealthy',
        error: error.message
      };
    }
  }

  /**
   * Optimize database performance
   */
  async optimize() {
    try {
      const db = mongoose.connection.db;
      
      // Run database maintenance commands
      const results = {
        reindexed: [],
        compacted: [],
        analyzed: []
      };
      
      // Get all collections
      const collections = await db.listCollections().toArray();
      
      for (const collection of collections) {
        const collectionName = collection.name;
        
        try {
          // Reindex collection
          await db.collection(collectionName).reIndex();
          results.reindexed.push(collectionName);
          
          // Get collection stats
          const stats = await db.collection(collectionName).stats();
          results.analyzed.push({
            name: collectionName,
            count: stats.count,
            size: stats.size,
            avgObjSize: stats.avgObjSize,
            indexSizes: stats.indexSizes
          });
          
        } catch (error) {
          logError(error, { 
            context: 'Collection optimization', 
            collection: collectionName 
          });
        }
      }
      
      logInfo('Database optimization completed', results);
      return results;
    } catch (error) {
      logError(error, { context: 'Database optimization' });
      throw error;
    }
  }

  /**
   * Clean up old data
   * @param {number} daysToKeep - Number of days to keep data
   */
  async cleanupOldData(daysToKeep = 90) {
    try {
      const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
      
      const results = {
        performanceMetrics: 0,
        exportJobs: 0,
        tokenBlacklist: 0
      };
      
      // Clean old performance metrics
      const perfResult = await mongoose.connection.db
        .collection('performancemetrics')
        .deleteMany({ timestamp: { $lt: cutoffDate } });
      results.performanceMetrics = perfResult.deletedCount;
      
      // Clean expired export jobs
      const exportResult = await mongoose.connection.db
        .collection('exportjobs')
        .deleteMany({ 
          expiresAt: { $lt: new Date() },
          status: 'completed'
        });
      results.exportJobs = exportResult.deletedCount;
      
      // Clean expired token blacklist entries
      const tokenResult = await mongoose.connection.db
        .collection('tokenblacklists')
        .deleteMany({ expiresAt: { $lt: new Date() } });
      results.tokenBlacklist = tokenResult.deletedCount;
      
      logInfo('Old data cleanup completed', {
        daysToKeep,
        results
      });
      
      return results;
    } catch (error) {
      logError(error, { context: 'Data cleanup', daysToKeep });
      throw error;
    }
  }

  /**
   * Reset query metrics
   */
  resetQueryMetrics() {
    this.queryMetrics.clear();
    logInfo('Query metrics reset');
  }

  /**
   * Get connection pool status
   * @returns {Object} - Connection pool status
   */
  getConnectionPoolStatus() {
    const connection = mongoose.connection;
    
    return {
      readyState: connection.readyState,
      readyStateText: this.getReadyStateText(connection.readyState),
      host: connection.host,
      port: connection.port,
      name: connection.name,
      collections: Object.keys(connection.collections).length
    };
  }

  /**
   * Get readable ready state text
   * @param {number} state - Ready state number
   * @returns {string} - Ready state text
   */
  getReadyStateText(state) {
    const states = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting'
    };
    return states[state] || 'unknown';
  }
}

module.exports = new DatabaseService();