const express = require('express');
const router = express.Router();
const deviceController = require('../controllers/deviceController');
const auth = require('../middlewares/authMiddleware');
const rateLimiter = require('../middlewares/rateLimiter');

router.use(auth, rateLimiter);

router.post('/', deviceController.registerDevice);
router.get('/', deviceController.listDevices);
router.patch('/:id', deviceController.updateDevice);
router.delete('/:id', deviceController.deleteDevice);
router.post('/:id/heartbeat', deviceController.heartbeat);

module.exports = router;

