// const express = require('express');
// const router = express.Router();
// const { signup, login, getProfile } = require('../controllers/auth.controller');
// const authMiddleware = require('../../middleware/auth');

// // ✅ SWAGGER DOCUMENTATION
// /**
//  * @swagger
//  * /api/auth/signup:
//  *   post:
//  *     summary: Create new user
//  *     tags: [Auth]
//  *     requestBody:
//  *       required: true
//  *       content:
//  *         application/json:
//  *           schema:
//  *             type: object
//  *             properties:
//  *               name:
//  *                 type: string
//  *                 example: "John Doe"
//  *               email:
//  *                 type: string
//  *                 example: "john@example.com"
//  *               password:
//  *                 type: string
//  *                 example: "password123"
//  *     responses:
//  *       201:
//  *         description: User created
//  */
// router.post('/signup', signup);

// /**
//  * @swagger
//  * /api/auth/login:
//  *   post:
//  *     summary: Login user
//  *     tags: [Auth]
//  *     requestBody:
//  *       required: true
//  *       content:
//  *         application/json:
//  *           schema:
//  *             type: object
//  *             properties:
//  *               email:
//  *                 type: string
//  *                 example: "john@example.com"
//  *               password:
//  *                 type: string
//  *                 example: "password123"
//  *     responses:
//  *       200:
//  *         description: Login successful
//  */
// router.post('/login', login);

// /**
//  * @swagger
//  * /api/auth/profile:
//  *   get:
//  *     summary: Get user profile
//  *     tags: [Auth]
//  *     security:
//  *       - bearerAuth: []
//  *     responses:
//  *       200:
//  *         description: User profile
//  */
// router.get('/profile', authMiddleware, getProfile);

// module.exports = router;

// src/routes/authRoutes.js
const express = require('express');
const { register, login, getProfile, updateProfile, getAllUsers, getUserById, getPendingSubConsultants, updateUserStatus, deleteUser } = require('../controllers/auth.controller');
const { authenticate } = require('../../middleware/auth');

// In Express 5, router is not a separate function
const authRoutes = express();

// Public routes
authRoutes.post('/register', register);
authRoutes.post('/login', login);

// Protected routes
authRoutes.get('/profile', authenticate, getProfile);
authRoutes.put('/profile', authenticate, updateProfile);
authRoutes.get('/users', authenticate, getAllUsers);
authRoutes.get('/users/pending', authenticate, getPendingSubConsultants);
authRoutes.get('/users/:id', authenticate, getUserById);
authRoutes.patch('/users/:id/status', authenticate, updateUserStatus);
authRoutes.delete('/users/:id', authenticate, deleteUser);
module.exports = authRoutes;