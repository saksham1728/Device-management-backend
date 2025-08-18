const express = require('express');
const router = express.Router({ mergeParams: true });
const logController = require('../controllers/logController');
const auth = require('../middlewares/authMiddleware');
const rateLimiter = require('../middlewares/rateLimiter');

router.use(auth, rateLimiter);

router.post('/', logController.createLog);
router.get('/', logController.getLogs);
router.get('/usage', logController.getUsage);

module.exports = router;

