const io = require('socket.io-client');
const http = require('http');
const app = require('../../app');
const realtimeService = require('../../services/realtimeService');
const tokenService = require('../../services/tokenService');
const User = require('../../models/user');

describe('WebSocket Integration', () => {
  let server, clientSocket, testUser, accessToken;

  beforeAll(async () => {
    // Create HTTP server
    server = http.createServer(app);
    
    // Initialize WebSocket service
    realtimeService.initialize(server);
    
    // Start server
    await new Promise((resolve) => {
      server.listen(0, resolve);
    });

    // Create test user
    testUser = new User({
      name: 'Test User',
      email: 'test@example.com',
      password: 'hashedpassword',
      role: 'user'
    });
    await testUser.save();

    // Generate access token
    accessToken = tokenService.generateAccessToken({
      id: testUser._id,
      role: testUser.role,
      email: testUser.email
    });
  });

  afterAll(async () => {
    await User.deleteMany({});
    server.close();
  });

  beforeEach((done) => {
    const port = server.address().port;
    clientSocket = io(`http://localhost:${port}`, {
      auth: {
        token: accessToken
      }
    });
    
    clientSocket.on('connect', done);
  });

  afterEach(() => {
    if (clientSocket.connected) {
      clientSocket.disconnect();
    }
  });

  describe('Connection', () => {
    test('should connect with valid token', (done) => {
      clientSocket.on('connected', (data) => {
        expect(data.message).toBe('Connected to real-time service');
        expect(data.userId).toBe(testUser._id.toString());
        done();
      });
    });

    test('should reject connection with invalid token', (done) => {
      const invalidSocket = io(`http://localhost:${server.address().port}`, {
        auth: {
          token: 'invalid.token.here'
        }
      });

      invalidSocket.on('connect_error', (error) => {
        expect(error.message).toBe('Authentication failed');
        invalidSocket.close();
        done();
      });
    });

    test('should reject connection without token', (done) => {
      const noTokenSocket = io(`http://localhost:${server.address().port}`);

      noTokenSocket.on('connect_error', (error) => {
        expect(error.message).toBe('Authentication token required');
        noTokenSocket.close();
        done();
      });
    });
  });

  describe('Room Management', () => {
    test('should join organization room', (done) => {
      const organizationId = 'org123';
      
      clientSocket.emit('join-organization', { organizationId });
      
      clientSocket.on('joined-organization', (data) => {
        expect(data.organizationId).toBe(organizationId);
        done();
      });
    });

    test('should leave organization room', (done) => {
      const organizationId = 'org123';
      
      // First join
      clientSocket.emit('join-organization', { organizationId });
      
      clientSocket.on('joined-organization', () => {
        // Then leave
        clientSocket.emit('leave-organization', { organizationId });
      });
      
      clientSocket.on('left-organization', (data) => {
        expect(data.organizationId).toBe(organizationId);
        done();
      });
    });

    test('should subscribe to device updates', (done) => {
      const deviceId = 'device123';
      
      clientSocket.emit('device-status-request', { deviceId });
      
      clientSocket.on('subscribed-device', (data) => {
        expect(data.deviceId).toBe(deviceId);
        done();
      });
    });
  });

  describe('Real-time Broadcasting', () => {
    test('should receive device update broadcast', (done) => {
      const deviceId = 'device123';
      const status = 'active';
      
      // Subscribe to device updates
      clientSocket.emit('device-status-request', { deviceId });
      
      clientSocket.on('subscribed-device', () => {
        // Broadcast device update
        realtimeService.broadcastDeviceUpdate(deviceId, status, testUser._id);
      });
      
      clientSocket.on('device-update', (data) => {
        expect(data.deviceId).toBe(deviceId);
        expect(data.status).toBe(status);
        expect(data.type).toBe('device_status_update');
        done();
      });
    });

    test('should receive device heartbeat broadcast', (done) => {
      const deviceId = 'device123';
      const timestamp = new Date();
      
      clientSocket.on('device-heartbeat', (data) => {
        expect(data.deviceId).toBe(deviceId);
        expect(data.type).toBe('device_heartbeat');
        expect(new Date(data.timestamp)).toBeInstanceOf(Date);
        done();
      });
      
      // Broadcast heartbeat
      realtimeService.broadcastHeartbeat(deviceId, timestamp, testUser._id);
    });

    test('should receive notifications', (done) => {
      const notification = {
        type: 'export_completed',
        message: 'Your export is ready'
      };
      
      clientSocket.on('notification', (data) => {
        expect(data.type).toBe(notification.type);
        expect(data.message).toBe(notification.message);
        expect(data.timestamp).toBeDefined();
        done();
      });
      
      // Send notification
      realtimeService.sendNotificationToUser(testUser._id, notification);
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid room data', (done) => {
      clientSocket.emit('join-organization', {});
      
      clientSocket.on('error', (data) => {
        expect(data.message).toBe('Organization ID required');
        done();
      });
    });

    test('should handle invalid device data', (done) => {
      clientSocket.emit('device-status-request', {});
      
      clientSocket.on('error', (data) => {
        expect(data.message).toBe('Device ID required');
        done();
      });
    });
  });

  describe('Connection Statistics', () => {
    test('should track connection statistics', () => {
      const stats = realtimeService.getConnectionStats();
      
      expect(stats).toHaveProperty('totalConnections');
      expect(stats).toHaveProperty('connectedUsers');
      expect(stats).toHaveProperty('rooms');
      expect(stats.totalConnections).toBeGreaterThan(0);
      expect(stats.connectedUsers).toBeGreaterThan(0);
    });
  });
});