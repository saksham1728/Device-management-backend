const request = require('supertest');
const app = require('../../app');
const User = require('../../models/user');
const Device = require('../../models/device');
const cacheService = require('../../services/cacheService');

describe('Caching Performance Tests', () => {
  let accessToken, testUser, testDevices;

  beforeAll(async () => {
    // Create test user
    testUser = new User({
      name: 'Test User',
      email: 'test@example.com',
      password: 'hashedpassword',
      role: 'user'
    });
    await testUser.save();

    // Generate access token
    const tokenService = require('../../services/tokenService');
    accessToken = tokenService.generateAccessToken({
      id: testUser._id,
      role: testUser.role,
      email: testUser.email
    });

    // Create test devices
    testDevices = [];
    for (let i = 0; i < 10; i++) {
      const device = new Device({
        name: `Test Device ${i}`,
        type: 'sensor',
        status: 'active',
        owner_id: testUser._id
      });
      await device.save();
      testDevices.push(device);
    }
  });

  afterAll(async () => {
    await User.deleteMany({});
    await Device.deleteMany({});
    await cacheService.close();
  });

  beforeEach(async () => {
    // Clear cache before each test
    await cacheService.redis.flushdb();
  });

  describe('Device Listing Cache Performance', () => {
    test('should cache device listings and improve response time', async () => {
      // First request (cache miss)
      const start1 = Date.now();
      const response1 = await request(app)
        .get('/api/devices')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      const time1 = Date.now() - start1;

      expect(response1.body.success).toBe(true);
      expect(response1.body.devices).toHaveLength(10);

      // Second request (cache hit)
      const start2 = Date.now();
      const response2 = await request(app)
        .get('/api/devices')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      const time2 = Date.now() - start2;

      expect(response2.body.success).toBe(true);
      expect(response2.body.devices).toHaveLength(10);

      // Cache hit should be significantly faster
      expect(time2).toBeLessThan(time1 * 0.5); // At least 50% faster
      console.log(`Cache miss: ${time1}ms, Cache hit: ${time2}ms`);
    });

    test('should invalidate cache on device updates', async () => {
      // Initial request to populate cache
      await request(app)
        .get('/api/devices')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      // Update a device (should invalidate cache)
      await request(app)
        .patch(`/api/devices/${testDevices[0]._id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Updated Device' })
        .expect(200);

      // Next request should be cache miss (slower)
      const start = Date.now();
      const response = await request(app)
        .get('/api/devices')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      const time = Date.now() - start;

      expect(response.body.success).toBe(true);
      // Should find the updated device
      const updatedDevice = response.body.devices.find(d => d._id === testDevices[0]._id.toString());
      expect(updatedDevice.name).toBe('Updated Device');
    });
  });

  describe('Analytics Cache Performance', () => {
    test('should cache analytics queries', async () => {
      // First analytics request (cache miss)
      const start1 = Date.now();
      const response1 = await request(app)
        .get('/api/analytics/dashboard')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      const time1 = Date.now() - start1;

      expect(response1.body.success).toBe(true);

      // Second request (cache hit)
      const start2 = Date.now();
      const response2 = await request(app)
        .get('/api/analytics/dashboard')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      const time2 = Date.now() - start2;

      expect(response2.body.success).toBe(true);

      // Cache hit should be faster
      expect(time2).toBeLessThan(time1);
      console.log(`Analytics cache miss: ${time1}ms, Cache hit: ${time2}ms`);
    });
  });

  describe('User Profile Cache Performance', () => {
    test('should cache user profile data', async () => {
      // First profile request (cache miss)
      const start1 = Date.now();
      const response1 = await request(app)
        .get('/api/users/profile')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      const time1 = Date.now() - start1;

      expect(response1.body.success).toBe(true);
      expect(response1.body.data.user.email).toBe(testUser.email);

      // Second request (cache hit)
      const start2 = Date.now();
      const response2 = await request(app)
        .get('/api/users/profile')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      const time2 = Date.now() - start2;

      expect(response2.body.success).toBe(true);
      expect(response2.body.data.user.email).toBe(testUser.email);

      // Cache hit should be faster
      expect(time2).toBeLessThan(time1);
      console.log(`Profile cache miss: ${time1}ms, Cache hit: ${time2}ms`);
    });
  });

  describe('Cache Hit Rate Monitoring', () => {
    test('should track cache hit rates', async () => {
      const endpoint = '/api/devices';
      
      // Make multiple requests to build cache statistics
      for (let i = 0; i < 5; i++) {
        await request(app)
          .get(endpoint)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);
      }

      // Get metrics to check cache performance
      const metricsResponse = await request(app)
        .get('/metrics')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(metricsResponse.body.success).toBe(true);
      expect(metricsResponse.body.data).toHaveProperty('cache');
      expect(metricsResponse.body.data.cache).toHaveProperty('hitRate');
      expect(metricsResponse.body.data.cache).toHaveProperty('missRate');
      
      // After multiple requests, hit rate should be > 0
      expect(metricsResponse.body.data.cache.hitRate).toBeGreaterThan(0);
    });
  });

  describe('Concurrent Request Handling', () => {
    test('should handle concurrent requests efficiently with caching', async () => {
      const concurrentRequests = 10;
      const requests = [];

      // Make concurrent requests
      const startTime = Date.now();
      for (let i = 0; i < concurrentRequests; i++) {
        requests.push(
          request(app)
            .get('/api/devices')
            .set('Authorization', `Bearer ${accessToken}`)
        );
      }

      const responses = await Promise.all(requests);
      const totalTime = Date.now() - startTime;

      // All requests should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });

      // Average time per request should be reasonable
      const avgTime = totalTime / concurrentRequests;
      expect(avgTime).toBeLessThan(100); // Should be under 100ms average

      console.log(`${concurrentRequests} concurrent requests completed in ${totalTime}ms (avg: ${avgTime}ms)`);
    });
  });
});