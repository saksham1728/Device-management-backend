const express = require('express');
const router = express.Router();
const exportController = require('../controllers/exportController');
const { auth } = require('../middlewares/auth');
const { exportRateLimiter } = require('../middlewares/rateLimiter');
const validate = require('../middlewares/validate');
const Joi = require('joi');

// Validation schemas
const createExportSchema = Joi.object({
  type: Joi.string().valid('logs', 'usage_report', 'device_report').required(),
  format: Joi.string().valid('csv', 'json').default('csv'),
  dateRange: Joi.object({
    startDate: Joi.date().required(),
    endDate: Joi.date().required()
  }).required(),
  filters: Joi.object({
    deviceIds: Joi.array().items(Joi.string().pattern(/^[0-9a-fA-F]{24}$/)),
    eventTypes: Joi.array().items(Joi.string()),
    includeInactive: Joi.boolean().default(false)
  }).default({})
});

const getJobsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(10),
  status: Joi.string().valid('pending', 'processing', 'completed', 'failed'),
  type: Joi.string().valid('logs', 'usage_report', 'device_report')
});

// Apply authentication and export rate limiting to all routes
router.use(auth, exportRateLimiter);

// Export job routes
router.post('/jobs', 
  validate(createExportSchema), 
  exportController.createExportJob
);

router.get('/jobs', 
  validate(getJobsQuerySchema, 'query'),
  exportController.getUserJobs
);

router.get('/jobs/:jobId', 
  exportController.getJobStatus
);

router.get('/jobs/:jobId/download', 
  exportController.downloadExport
);

router.delete('/jobs/:jobId', 
  exportController.deleteExportJob
);

router.get('/stats', 
  exportController.getExportStats
);

module.exports = router;