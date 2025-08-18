const Joi = require('joi');

const createLogSchema = Joi.object({
  event: Joi.string().required(),
  value: Joi.number().required()
});

module.exports = { createLogSchema };

