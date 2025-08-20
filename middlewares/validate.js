module.exports = (schema, source = 'body') => (req, res, next) => {
  const dataToValidate = source === 'query' ? req.query : req.body;
  const { error, value } = schema.validate(dataToValidate);
  
  if (error) {
    return res.status(400).json({ 
      success: false, 
      error: {
        code: 'VALIDATION_ERROR',
        message: error.details[0].message,
        field: error.details[0].path.join('.')
      }
    });
  }
  
  // Replace the original data with validated data (applies defaults)
  if (source === 'query') {
    req.query = value;
  } else {
    req.body = value;
  }
  
  next();
};

