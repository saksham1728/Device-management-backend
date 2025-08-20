const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { auth, adminAuth } = require('../middlewares/auth');
const { generalRateLimiter, roleBasedRateLimiter } = require('../middlewares/rateLimiter');
const { cache, userCacheKey } = require('../middlewares/cache');
const validate = require('../middlewares/validate');
const Joi = require('joi');

// Validation schemas
const updateProfileSchema = Joi.object({
  name: Joi.string().min(2).max(50),
  email: Joi.string().email()
});

const getUsersQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  role: Joi.string().valid('user', 'admin'),
  search: Joi.string().max(100)
});

// User profile routes with general rate limiting
router.get('/profile', 
  auth, 
  generalRateLimiter,
  cache(900, userCacheKey), // Cache for 15 minutes
  userController.getProfile
);

router.put('/profile', 
  auth, 
  generalRateLimiter,
  validate(updateProfileSchema), 
  userController.updateProfile
);

// Admin routes with role-based rate limiting
router.get('/users', 
  auth, 
  adminAuth, 
  roleBasedRateLimiter,
  validate(getUsersQuerySchema, 'query'),
  cache(300), // Cache for 5 minutes
  userController.getAllUsers
);

module.exports = router;