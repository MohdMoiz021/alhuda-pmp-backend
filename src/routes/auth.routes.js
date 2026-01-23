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
const router = express.Router();
const AuthController = require('../controllers/auth.controller');
const { authenticate } = require('../../middleware/auth');
const { registerValidationRules, loginValidationRules, validate } = require('../utils/validators');

// Public routes
router.post('/register', registerValidationRules(), validate, AuthController.register);
router.post('/login', loginValidationRules(), validate, AuthController.login);

// Protected routes
router.get('/profile', authenticate, AuthController.getProfile);
router.put('/profile', authenticate, AuthController.updateProfile);

module.exports = router;