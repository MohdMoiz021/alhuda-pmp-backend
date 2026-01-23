// src/middleware/errorHandler.js
const { HTTP_STATUS } = require('../config/constant');
const logger = require('../src/utils/logger');

const errorHandler = (err, req, res, next) => {
  logger.error('Unhandled error', err);
  
  const statusCode = err.statusCode || HTTP_STATUS.SERVER_ERROR;
  const message = err.message || 'Internal server error';
  
  res.status(statusCode).json({
    success: false,
    message: message,
    error: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
};

const notFoundHandler = (req, res, next) => {
  const error = new Error(`Route not found - ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
};

module.exports = {
  errorHandler,
  notFoundHandler
};