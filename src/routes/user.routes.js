// src/routes/userRoutes.js
const express = require('express');
const router = express.Router();
const UserController = require('../controllers/user.Controller');
const { authenticate, authorize } = require('../../middleware/auth');
const { USER_ROLES } = require('../../config/constant');

// All user routes require authentication and admin_c role
router.use(authenticate, authorize(USER_ROLES.ADMIN_C));

// User management routes
router.get('/', UserController.getAllUsers);
router.get('/stats', UserController.getUserStats);
router.get('/:id', UserController.getUserById);
router.put('/:id', UserController.updateUser);

module.exports = router;