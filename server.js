const http = require('http');
const mongoose = require('mongoose');
const config = require('./config');
const app = require('./app');

// Import services
const databaseService = require('./services/databaseService');
const realtimeService = require('./services/realtimeService');
const jobQueue = require('./services/jobQueue');
const exportWorker = require('./workers/exportWorker');
const { logInfo, logError } = require('./services/logger');

// Import background jobs
require('./jobs/deviceDeactivationJob');

// Graceful shutdown handler
const gracefulShutdown = async (signal) => {
  logInfo(`Received ${signal}. Starting graceful shutdown...`);
  
  try {
    // Stop accepting new connections
    server.close(() => {
      logInfo('HTTP server closed');
    });
    
    // Stop workers
    await exportWorker.stop();
    
    // Close job queues
    await jobQueue.close();
    
    // Close database connection
    await mongoose.connection.close();
    
    logInfo('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logError(error, { context: 'Graceful shutdown' });
    process.exit(1);
  }
};

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logError(error, { context: 'Uncaught exception' });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logError(new Error('Unhandled rejection'), { 
    context: 'Unhandled promise rejection',
    reason: reason.toString(),
    promise: promise.toString()
  });
  process.exit(1);
});

// Create HTTP server
const server = http.createServer(app);

// Initialize services and start server
async function startServer() {
  try {
    // Connect to MongoDB with optimizations
    await mongoose.connect(config.mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      maxPoolSize: 10,
      minPoolSize: 2,
      maxIdleTimeMS: 30000,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    
    logInfo('MongoDB connected successfully');
    
    // Initialize database service
    await databaseService.initialize();
    
    // Initialize job queue
    jobQueue.initialize();
    
    // Start export worker
    exportWorker.start();
    
    // Initialize WebSocket service
    realtimeService.initialize(server);
    
    // Start HTTP server
    server.listen(config.port, () => {
      logInfo(`Server running on port ${config.port}`, {
        environment: process.env.NODE_ENV || 'development',
        nodeVersion: process.version,
        platform: process.platform
      });
    });
    
    // Log startup completion
    logInfo('All services initialized successfully');
    
  } catch (error) {
    logError(error, { context: 'Server startup' });
    process.exit(1);
  }
}

// Start the server
startServer();
