const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../app');
const User = require('../models/user');

describe('Auth Controller', () => {
  beforeAll(async () => {
    await mongoose.connect('mongodb://localhost:27017/device_management_test', { useNewUrlParser: true, useUnifiedTopology: true });
  });
  afterAll(async () => {
    await User.deleteMany({});
    await mongoose.connection.close();
  });
  it('should register a new user', async () => {
    const res = await request(app)
      .post('/auth/signup')
      .send({ name: 'Test User', email: 'test@example.com', password: 'Test1234', role: 'user' });
    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('User registered successfully');
  });
});

