const express = require('express');
const router = express.Router();
const deviceController = require('../controllers/deviceController');
const { auth } = require('../middlewares/auth');
const { deviceRateLimiter } = require('../middlewares/rateLimiter');
const { cache, deviceCacheKey } = require('../middlewares/cache');
const validate = require('../middlewares/validate');
const Joi = require('joi');

// Validation schemas
const deviceSchema = Joi.object({
  name: Joi.string().required().min(2).max(100),
  type: Joi.string().required().min(2).max(50),
  status: Joi.string().valid('active', 'inactive').default('active')
});

const updateDeviceSchema = Joi.object({
  name: Joi.string().min(2).max(100),
  type: Joi.string().min(2).max(50),
  status: Joi.string().valid('active', 'inactive')
});

const heartbeatSchema = Joi.object({
  status: Joi.string().valid('active', 'inactive').required()
});

const deviceQuerySchema = Joi.object({
  type: Joi.string().max(50),
  status: Joi.string().valid('active', 'inactive'),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10)
});

// Apply auth and device-specific rate limiting to all routes
router.use(auth, deviceRateLimiter);

// Device CRUD routes
router.post('/', 
  validate(deviceSchema), 
  deviceController.registerDevice
);

router.get('/', 
  validate(deviceQuerySchema, 'query'),
  cache(1800, deviceCacheKey), // Cache for 30 minutes
  deviceController.listDevices
);

router.patch('/:id', 
  validate(updateDeviceSchema), 
  deviceController.updateDevice
);

router.delete('/:id', 
  deviceController.deleteDevice
);

router.post('/:id/heartbeat', 
  validate(heartbeatSchema), 
  deviceController.heartbeat
);

module.exports = router;

