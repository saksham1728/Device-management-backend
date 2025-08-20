const { Server } = require('socket.io');
const tokenService = require('./tokenService');
const { logSecurityEvent, logInfo } = require('./logger');

class RealtimeService {
  constructor() {
    this.io = null;
    this.connectedUsers = new Map(); // userId -> Set of socket IDs
    this.socketUsers = new Map(); // socket ID -> user info
  }

  /**
   * Initialize Socket.io server
   * @param {Object} server - HTTP server instance
   */
  initialize(server) {
    this.io = new Server(server, {
      cors: {
        origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
        methods: ['GET', 'POST'],
        credentials: true
      },
      transports: ['websocket', 'polling']
    });

    this.setupMiddleware();
    this.setupEventHandlers();
    
    logInfo('WebSocket server initialized');
  }

  /**
   * Setup Socket.io middleware
   */
  setupMiddleware() {
    // Authentication middleware
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
          return next(new Error('Authentication token required'));
        }

        // Verify token
        const decoded = await tokenService.verifyToken(token, 'access');
        
        // Store user info in socket
        socket.userId = decoded.id;
        socket.userRole = decoded.role;
        socket.userEmail = decoded.email;
        
        logInfo('WebSocket authentication successful', {
          userId: decoded.id,
          socketId: socket.id,
          ip: socket.handshake.address
        });
        
        next();
      } catch (error) {
        logSecurityEvent('WEBSOCKET_AUTH_FAILED', {
          error: error.message,
          socketId: socket.id,
          ip: socket.handshake.address
        });
        
        next(new Error('Authentication failed'));
      }
    });

    // Rate limiting middleware
    this.io.use((socket, next) => {
      // Simple rate limiting - max 100 events per minute per socket
      if (!socket.rateLimitData) {
        socket.rateLimitData = {
          count: 0,
          resetTime: Date.now() + 60000 // 1 minute
        };
      }

      if (Date.now() > socket.rateLimitData.resetTime) {
        socket.rateLimitData.count = 0;
        socket.rateLimitData.resetTime = Date.now() + 60000;
      }

      if (socket.rateLimitData.count >= 100) {
        return next(new Error('Rate limit exceeded'));
      }

      socket.rateLimitData.count++;
      next();
    });
  }

  /**
   * Setup event handlers
   */
  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      this.handleConnection(socket);
      
      socket.on('disconnect', (reason) => {
        this.handleDisconnection(socket, reason);
      });

      socket.on('join-organization', (data) => {
        this.handleJoinOrganization(socket, data);
      });

      socket.on('leave-organization', (data) => {
        this.handleLeaveOrganization(socket, data);
      });

      socket.on('device-status-request', (data) => {
        this.handleDeviceStatusRequest(socket, data);
      });

      socket.on('error', (error) => {
        logSecurityEvent('WEBSOCKET_ERROR', {
          error: error.message,
          userId: socket.userId,
          socketId: socket.id
        });
      });
    });
  }

  /**
   * Handle new connection
   * @param {Object} socket - Socket instance
   */
  handleConnection(socket) {
    const userId = socket.userId;
    
    // Track connected users
    if (!this.connectedUsers.has(userId)) {
      this.connectedUsers.set(userId, new Set());
    }
    this.connectedUsers.get(userId).add(socket.id);
    
    // Track socket users
    this.socketUsers.set(socket.id, {
      userId,
      role: socket.userRole,
      email: socket.userEmail,
      connectedAt: new Date(),
      ip: socket.handshake.address
    });

    // Join user to their personal room
    socket.join(`user:${userId}`);
    
    // Join user to their role-based room
    socket.join(`role:${socket.userRole}`);

    // Send connection confirmation
    socket.emit('connected', {
      message: 'Connected to real-time service',
      userId,
      socketId: socket.id,
      timestamp: new Date().toISOString()
    });

    logInfo('WebSocket connection established', {
      userId,
      socketId: socket.id,
      totalConnections: this.io.engine.clientsCount
    });
  }

  /**
   * Handle disconnection
   * @param {Object} socket - Socket instance
   * @param {string} reason - Disconnection reason
   */
  handleDisconnection(socket, reason) {
    const userId = socket.userId;
    const socketId = socket.id;

    // Remove from tracking
    if (this.connectedUsers.has(userId)) {
      this.connectedUsers.get(userId).delete(socketId);
      if (this.connectedUsers.get(userId).size === 0) {
        this.connectedUsers.delete(userId);
      }
    }
    
    this.socketUsers.delete(socketId);

    logInfo('WebSocket disconnection', {
      userId,
      socketId,
      reason,
      totalConnections: this.io.engine.clientsCount
    });
  }

  /**
   * Handle joining organization room
   * @param {Object} socket - Socket instance
   * @param {Object} data - Organization data
   */
  handleJoinOrganization(socket, data) {
    const { organizationId } = data;
    
    if (!organizationId) {
      socket.emit('error', { message: 'Organization ID required' });
      return;
    }

    socket.join(`org:${organizationId}`);
    socket.emit('joined-organization', { organizationId });
    
    logInfo('User joined organization room', {
      userId: socket.userId,
      organizationId,
      socketId: socket.id
    });
  }

  /**
   * Handle leaving organization room
   * @param {Object} socket - Socket instance
   * @param {Object} data - Organization data
   */
  handleLeaveOrganization(socket, data) {
    const { organizationId } = data;
    
    if (!organizationId) {
      socket.emit('error', { message: 'Organization ID required' });
      return;
    }

    socket.leave(`org:${organizationId}`);
    socket.emit('left-organization', { organizationId });
    
    logInfo('User left organization room', {
      userId: socket.userId,
      organizationId,
      socketId: socket.id
    });
  }

  /**
   * Handle device status request
   * @param {Object} socket - Socket instance
   * @param {Object} data - Device data
   */
  handleDeviceStatusRequest(socket, data) {
    const { deviceId } = data;
    
    if (!deviceId) {
      socket.emit('error', { message: 'Device ID required' });
      return;
    }

    // Join device-specific room for updates
    socket.join(`device:${deviceId}`);
    socket.emit('subscribed-device', { deviceId });
    
    logInfo('User subscribed to device updates', {
      userId: socket.userId,
      deviceId,
      socketId: socket.id
    });
  }

  /**
   * Broadcast device status update
   * @param {string} deviceId - Device ID
   * @param {Object} status - Device status
   * @param {string} ownerId - Device owner ID
   */
  broadcastDeviceUpdate(deviceId, status, ownerId) {
    if (!this.io) return;

    const updateData = {
      deviceId,
      status,
      timestamp: new Date().toISOString(),
      type: 'device_status_update'
    };

    // Broadcast to device-specific room
    this.io.to(`device:${deviceId}`).emit('device-update', updateData);
    
    // Broadcast to device owner
    this.io.to(`user:${ownerId}`).emit('device-update', updateData);

    logInfo('Device update broadcasted', {
      deviceId,
      status,
      ownerId,
      recipients: this.io.sockets.adapter.rooms.get(`device:${deviceId}`)?.size || 0
    });
  }

  /**
   * Broadcast device heartbeat
   * @param {string} deviceId - Device ID
   * @param {Date} timestamp - Heartbeat timestamp
   * @param {string} ownerId - Device owner ID
   * @param {string} organizationId - Organization ID (optional)
   */
  broadcastHeartbeat(deviceId, timestamp, ownerId, organizationId = null) {
    if (!this.io) return;

    const heartbeatData = {
      deviceId,
      timestamp: timestamp.toISOString(),
      type: 'device_heartbeat'
    };

    // Broadcast to device owner
    this.io.to(`user:${ownerId}`).emit('device-heartbeat', heartbeatData);
    
    // Broadcast to organization if specified
    if (organizationId) {
      this.io.to(`org:${organizationId}`).emit('device-heartbeat', heartbeatData);
    }

    logInfo('Device heartbeat broadcasted', {
      deviceId,
      ownerId,
      organizationId
    });
  }

  /**
   * Send notification to specific user
   * @param {string} userId - User ID
   * @param {Object} notification - Notification data
   */
  sendNotificationToUser(userId, notification) {
    if (!this.io) return;

    this.io.to(`user:${userId}`).emit('notification', {
      ...notification,
      timestamp: new Date().toISOString()
    });

    logInfo('Notification sent to user', {
      userId,
      type: notification.type
    });
  }

  /**
   * Broadcast system announcement
   * @param {Object} announcement - Announcement data
   * @param {string} targetRole - Target role (optional)
   */
  broadcastAnnouncement(announcement, targetRole = null) {
    if (!this.io) return;

    const target = targetRole ? `role:${targetRole}` : 'all';
    
    if (target === 'all') {
      this.io.emit('announcement', {
        ...announcement,
        timestamp: new Date().toISOString()
      });
    } else {
      this.io.to(target).emit('announcement', {
        ...announcement,
        timestamp: new Date().toISOString()
      });
    }

    logInfo('System announcement broadcasted', {
      target,
      type: announcement.type
    });
  }

  /**
   * Get connection statistics
   * @returns {Object} - Connection statistics
   */
  getConnectionStats() {
    if (!this.io) {
      return { totalConnections: 0, connectedUsers: 0 };
    }

    return {
      totalConnections: this.io.engine.clientsCount,
      connectedUsers: this.connectedUsers.size,
      rooms: Array.from(this.io.sockets.adapter.rooms.keys()),
      userConnections: Array.from(this.connectedUsers.entries()).map(([userId, sockets]) => ({
        userId,
        socketCount: sockets.size
      }))
    };
  }

  /**
   * Disconnect user from all sockets
   * @param {string} userId - User ID
   * @param {string} reason - Disconnection reason
   */
  disconnectUser(userId, reason = 'forced_disconnect') {
    if (!this.io || !this.connectedUsers.has(userId)) return;

    const userSockets = this.connectedUsers.get(userId);
    userSockets.forEach(socketId => {
      const socket = this.io.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit('force-disconnect', { reason });
        socket.disconnect(true);
      }
    });

    logInfo('User forcefully disconnected', {
      userId,
      reason,
      socketCount: userSockets.size
    });
  }
}

module.exports = new RealtimeService();