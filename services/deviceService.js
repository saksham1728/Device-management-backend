const Joi = require('joi');

const registerDeviceSchema = Joi.object({
  name: Joi.string().required(),
  type: Joi.string().required(),
  status: Joi.string().valid('active', 'inactive').default('active')
});

const heartbeatSchema = Joi.object({
  status: Joi.string().valid('active', 'inactive').required()
});

module.exports = { registerDeviceSchema, heartbeatSchema };

