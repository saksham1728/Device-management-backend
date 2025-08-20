const tokenService = require('./tokenService');
const { logInfo, logSecurityEvent } = require('./logger');

class SSEService {
  constructor() {
    this.connections = new Map(); // userId -> Set of response objects
    this.lastEventId = 0;
    this.eventHistory = []; // Store recent events for replay
    this.maxHistorySize = 100;
  }

  /**
   * Handle SSE connection
   * @param {Object} req - Express request
   * @param {Object} res - Express response
   */
  async handleConnection(req, res) {
    try {
      // Authenticate user
      const token = req.header('Authorization')?.replace('Bearer ', '') || req.query.token;
      if (!token) {
        return res.status(401).json({ error: 'Authentication token required' });
      }

      const decoded = await tokenService.verifyToken(token, 'access');
      const userId = decoded.id;

      // Set SSE headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control',
        'X-Accel-Buffering': 'no' // Disable nginx buffering
      });

      // Send initial connection event
      this.sendEvent(res, 'connected', {
        message: 'Connected to SSE stream',
        userId,
        timestamp: new Date().toISOString()
      });

      // Track connection
      if (!this.connections.has(userId)) {
        this.connections.set(userId, new Set());
      }
      this.connections.get(userId).add(res);

      // Handle client disconnect
      req.on('close', () => {
        this.handleDisconnection(userId, res);
      });

      req.on('aborted', () => {
        this.handleDisconnection(userId, res);
      });

      // Send recent events if requested
      const lastEventId = parseInt(req.headers['last-event-id']) || 0;
      if (lastEventId > 0) {
        this.replayEvents(res, lastEventId);
      }

      // Keep connection alive with periodic heartbeat
      const heartbeatInterval = setInterval(() => {
        if (res.writableEnded) {
          clearInterval(heartbeatInterval);
          return;
        }
        this.sendEvent(res, 'heartbeat', { timestamp: new Date().toISOString() });
      }, 30000); // 30 seconds

      logInfo('SSE connection established', {
        userId,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

    } catch (error) {
      logSecurityEvent('SSE_AUTH_FAILED', {
        error: error.message,
        ip: req.ip
      });
      
      res.status(401).json({ error: 'Authentication failed' });
    }
  }

  /**
   * Handle disconnection
   * @param {string} userId - User ID
   * @param {Object} res - Response object
   */
  handleDisconnection(userId, res) {
    if (this.connections.has(userId)) {
      this.connections.get(userId).delete(res);
      if (this.connections.get(userId).size === 0) {
        this.connections.delete(userId);
      }
    }

    logInfo('SSE connection closed', { userId });
  }

  /**
   * Send SSE event
   * @param {Object} res - Response object
   * @param {string} event - Event type
   * @param {Object} data - Event data
   * @param {number} id - Event ID
   */
  sendEvent(res, event, data, id = null) {
    if (res.writableEnded) return;

    const eventId = id || ++this.lastEventId;
    const eventData = JSON.stringify(data);

    try {
      res.write(`id: ${eventId}\n`);
      res.write(`event: ${event}\n`);
      res.write(`data: ${eventData}\n\n`);
    } catch (error) {
      console.error('Error sending SSE event:', error);
    }
  }

  /**
   * Broadcast event to specific user
   * @param {string} userId - User ID
   * @param {string} event - Event type
   * @param {Object} data - Event data
   */
  broadcastToUser(userId, event, data) {
    if (!this.connections.has(userId)) return;

    const eventId = ++this.lastEventId;
    const eventData = {
      ...data,
      timestamp: new Date().toISOString()
    };

    // Store in history
    this.addToHistory(eventId, event, eventData);

    // Send to all user connections
    const userConnections = this.connections.get(userId);
    userConnections.forEach(res => {
      this.sendEvent(res, event, eventData, eventId);
    });

    logInfo('SSE event broadcasted to user', {
      userId,
      event,
      connectionCount: userConnections.size
    });
  }

  /**
   * Broadcast event to all connected users
   * @param {string} event - Event type
   * @param {Object} data - Event data
   */
  broadcastToAll(event, data) {
    const eventId = ++this.lastEventId;
    const eventData = {
      ...data,
      timestamp: new Date().toISOString()
    };

    // Store in history
    this.addToHistory(eventId, event, eventData);

    let totalSent = 0;
    this.connections.forEach((userConnections, userId) => {
      userConnections.forEach(res => {
        this.sendEvent(res, event, eventData, eventId);
        totalSent++;
      });
    });

    logInfo('SSE event broadcasted to all', {
      event,
      connectionCount: totalSent
    });
  }

  /**
   * Send device update via SSE
   * @param {string} deviceId - Device ID
   * @param {Object} status - Device status
   * @param {string} ownerId - Device owner ID
   */
  sendDeviceUpdate(deviceId, status, ownerId) {
    this.broadcastToUser(ownerId, 'device-update', {
      deviceId,
      status,
      type: 'device_status_update'
    });
  }

  /**
   * Send device heartbeat via SSE
   * @param {string} deviceId - Device ID
   * @param {Date} timestamp - Heartbeat timestamp
   * @param {string} ownerId - Device owner ID
   */
  sendDeviceHeartbeat(deviceId, timestamp, ownerId) {
    this.broadcastToUser(ownerId, 'device-heartbeat', {
      deviceId,
      timestamp: timestamp.toISOString(),
      type: 'device_heartbeat'
    });
  }

  /**
   * Add event to history
   * @param {number} id - Event ID
   * @param {string} event - Event type
   * @param {Object} data - Event data
   */
  addToHistory(id, event, data) {
    this.eventHistory.push({ id, event, data, timestamp: new Date() });
    
    // Limit history size
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }
  }

  /**
   * Replay events from history
   * @param {Object} res - Response object
   * @param {number} lastEventId - Last received event ID
   */
  replayEvents(res, lastEventId) {
    const eventsToReplay = this.eventHistory.filter(event => event.id > lastEventId);
    
    eventsToReplay.forEach(event => {
      this.sendEvent(res, event.event, event.data, event.id);
    });

    if (eventsToReplay.length > 0) {
      logInfo('SSE events replayed', {
        count: eventsToReplay.length,
        fromEventId: lastEventId
      });
    }
  }

  /**
   * Get connection statistics
   * @returns {Object} - Connection statistics
   */
  getConnectionStats() {
    let totalConnections = 0;
    this.connections.forEach(userConnections => {
      totalConnections += userConnections.size;
    });

    return {
      totalConnections,
      connectedUsers: this.connections.size,
      lastEventId: this.lastEventId,
      historySize: this.eventHistory.length
    };
  }

  /**
   * Close all connections for a user
   * @param {string} userId - User ID
   */
  closeUserConnections(userId) {
    if (!this.connections.has(userId)) return;

    const userConnections = this.connections.get(userId);
    userConnections.forEach(res => {
      if (!res.writableEnded) {
        this.sendEvent(res, 'force-disconnect', { reason: 'User logged out' });
        res.end();
      }
    });

    this.connections.delete(userId);
    
    logInfo('SSE user connections closed', {
      userId,
      connectionCount: userConnections.size
    });
  }
}

module.exports = new SSEService();