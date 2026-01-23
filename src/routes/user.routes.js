const express = require('express');
const { getAllUsers } = require('../controllers/user.Controller');
const { authenticate } = require('../../middleware/auth');

const userRoutes = express();

// All user routes require authentication
userRoutes.use(authenticate);

// User management routes
userRoutes.get('/', getAllUsers);

module.exports = userRoutes;