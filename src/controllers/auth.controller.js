// src/controllers/authController.js
const userRepository = require('../repositories/userRepository');
const { hashPassword, comparePassword, generateToken } = require('../utils/auth');
const { ERROR_MESSAGES, HTTP_STATUS, USER_ROLES } = require('../../config/constant');
const logger = require('../utils/logger');

class AuthController {
  // Register new user
  static async register(req, res) {
    try {
      const { email, password, first_name, last_name, phone, company_name, role } = req.body;

      // Check if user already exists
      const existingUser = await userRepository.findByEmail(email);
      if (existingUser) {
        return res.status(HTTP_STATUS.CONFLICT).json({
          success: false,
          message: ERROR_MESSAGES.EMAIL_EXISTS
        });
      }

      // Hash password
      const password_hash = await hashPassword(password);

      // Create user
      const userData = {
        email,
        password_hash,
        first_name,
        last_name,
        phone,
        company_name,
        role: role || USER_ROLES.ADMIN_A
      };

      const newUser = await userRepository.create(userData);

      // Generate token
      const token = generateToken(newUser);

      // Remove password hash from response
      const { password_hash: _, ...userWithoutPassword } = newUser;

      logger.info(`User registered: ${email}`);

      res.status(HTTP_STATUS.CREATED).json({
        success: true,
        message: 'User registered successfully',
        data: {
          user: userWithoutPassword,
          token
        }
      });

    } catch (error) {
      logger.error('Registration error', error);
      res.status(HTTP_STATUS.SERVER_ERROR).json({
        success: false,
        message: ERROR_MESSAGES.SERVER_ERROR
      });
    }
  }

  // Login user
  static async login(req, res) {
    try {
      const { email, password } = req.body;

      // Find user
      const user = await userRepository.findByEmail(email);
      if (!user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          success: false,
          message: ERROR_MESSAGES.INVALID_CREDENTIALS
        });
      }

      // Check if user is active
      if (!user.is_active) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          success: false,
          message: 'Account is deactivated. Please contact administrator.'
        });
      }

      // Verify password
      const isValidPassword = await comparePassword(password, user.password_hash);
      if (!isValidPassword) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          success: false,
          message: ERROR_MESSAGES.INVALID_CREDENTIALS
        });
      }

      // Update last login
      await userRepository.updateLastLogin(user.id);

      // Generate token
      const token = generateToken(user);

      // Remove password hash from response
      const { password_hash, ...userWithoutPassword } = user;

      logger.info(`User logged in: ${email}`);

      res.json({
        success: true,
        message: 'Login successful',
        data: {
          user: userWithoutPassword,
          token
        }
      });

    } catch (error) {
      logger.error('Login error', error);
      res.status(HTTP_STATUS.SERVER_ERROR).json({
        success: false,
        message: ERROR_MESSAGES.SERVER_ERROR
      });
    }
  }

  // Get current user profile
  static async getProfile(req, res) {
    try {
      const user = await userRepository.findById(req.user.id);
      
      if (!user) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          success: false,
          message: ERROR_MESSAGES.USER_NOT_FOUND
        });
      }

      res.json({
        success: true,
        data: user
      });

    } catch (error) {
      logger.error('Get profile error', error);
      res.status(HTTP_STATUS.SERVER_ERROR).json({
        success: false,
        message: ERROR_MESSAGES.SERVER_ERROR
      });
    }
  }

  // Update profile
  static async updateProfile(req, res) {
    try {
      const { first_name, last_name, phone, company_name } = req.body;
      const updates = {};

      if (first_name !== undefined) updates.first_name = first_name;
      if (last_name !== undefined) updates.last_name = last_name;
      if (phone !== undefined) updates.phone = phone;
      if (company_name !== undefined) updates.company_name = company_name;

      if (Object.keys(updates).length === 0) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          message: 'No updates provided'
        });
      }

      const updatedUser = await userRepository.update(req.user.id, updates);

      res.json({
        success: true,
        message: 'Profile updated successfully',
        data: updatedUser
      });

    } catch (error) {
      logger.error('Update profile error', error);
      res.status(HTTP_STATUS.SERVER_ERROR).json({
        success: false,
        message: ERROR_MESSAGES.SERVER_ERROR
      });
    }
  }
}

module.exports = AuthController;