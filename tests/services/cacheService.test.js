const cacheService = require('../../services/cacheService');

describe('CacheService', () => {
  beforeAll(async () => {
    // Initialize cache service for testing
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  afterAll(async () => {
    await cacheService.close();
  });

  beforeEach(async () => {
    // Clear cache before each test
    await cacheService.redis.flushdb();
  });

  describe('Basic Operations', () => {
    test('should set and get a value', async () => {
      const key = 'test:key';
      const value = { message: 'Hello World' };
      
      await cacheService.set(key, value, 60);
      const result = await cacheService.get(key);
      
      expect(result).toEqual(value);
    });

    test('should return null for non-existent key', async () => {
      const result = await cacheService.get('non:existent');
      expect(result).toBeNull();
    });

    test('should delete a key', async () => {
      const key = 'test:delete';
      const value = 'test value';
      
      await cacheService.set(key, value);
      await cacheService.del(key);
      
      const result = await cacheService.get(key);
      expect(result).toBeNull();
    });

    test('should check if key exists', async () => {
      const key = 'test:exists';
      
      expect(await cacheService.exists(key)).toBe(false);
      
      await cacheService.set(key, 'value');
      expect(await cacheService.exists(key)).toBe(true);
    });
  });

  describe('Pattern Operations', () => {
    test('should invalidate keys by pattern', async () => {
      await cacheService.set('user:1:profile', { name: 'John' });
      await cacheService.set('user:1:settings', { theme: 'dark' });
      await cacheService.set('user:2:profile', { name: 'Jane' });
      
      await cacheService.invalidatePattern('user:1:*');
      
      expect(await cacheService.get('user:1:profile')).toBeNull();
      expect(await cacheService.get('user:1:settings')).toBeNull();
      expect(await cacheService.get('user:2:profile')).toEqual({ name: 'Jane' });
    });
  });

  describe('TTL and Expiration', () => {
    test('should expire keys after TTL', async () => {
      const key = 'test:ttl';
      const value = 'expires soon';
      
      await cacheService.set(key, value, 1); // 1 second TTL
      
      expect(await cacheService.get(key)).toEqual(value);
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      expect(await cacheService.get(key)).toBeNull();
    }, 2000);
  });

  describe('Health Check', () => {
    test('should return connected status', async () => {
      const health = await cacheService.getHealth();
      expect(health).toBe('connected');
    });
  });
});