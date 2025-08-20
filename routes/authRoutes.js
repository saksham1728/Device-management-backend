const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const validate = require('../middlewares/validate');
const { auth } = require('../middlewares/auth');
const { authRateLimiter, strictRateLimiter } = require('../middlewares/rateLimiter');
const { signupSchema, loginSchema } = require('../services/userService');
const Joi = require('joi');

// Additional validation schemas
const refreshTokenSchema = Joi.object({
  refreshToken: Joi.string().required()
});

const logoutSchema = Joi.object({
  refreshToken: Joi.string().optional()
});

const revokeTokenSchema = Joi.object({
  token: Joi.string().required(),
  type: Joi.string().valid('access', 'refresh').default('refresh')
});

// Public routes with auth rate limiting
router.post('/signup', authRateLimiter, validate(signupSchema), authController.signup);
router.post('/login', authRateLimiter, validate(loginSchema), authController.login);
router.post('/refresh', authRateLimiter, validate(refreshTokenSchema), authController.refreshToken);

// Protected routes (require authentication) with strict rate limiting
router.post('/logout', auth, authRateLimiter, validate(logoutSchema), authController.logout);
router.post('/logout-all', auth, strictRateLimiter, authController.logoutAll);
router.post('/revoke', auth, strictRateLimiter, validate(revokeTokenSchema), authController.revokeToken);

module.exports = router;

