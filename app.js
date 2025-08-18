const express = require('express');
const morgan = require('morgan');
const authRoutes = require('./routes/authRoutes');
const deviceRoutes = require('./routes/deviceRoutes');
const logRoutes = require('./routes/logRoutes');

const app = express();

app.use(express.json());
app.use(morgan('dev'));

app.use('/auth', authRoutes);
app.use('/devices', deviceRoutes);
app.use('/devices/:id/logs', logRoutes);
app.use('/devices/:id/usage', logRoutes);

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ success: false, message: err.message || 'Server Error' });
});

module.exports = app;
