// src/controllers/userController.js
const userRepository = require('../repositories/userRepository');
const { USER_ROLES, HTTP_STATUS, ERROR_MESSAGES } = require('../../config/constant');
const logger = require('../utils/logger');

class UserController {
  // Get all users (Admin only)
  static async getAllUsers(req, res) {
    try {
      const { role, page = 1, limit = 20 } = req.query;
      const offset = (page - 1) * limit;

      let users;
      let total;

      if (role && Object.values(USER_ROLES).includes(role)) {
        users = await userRepository.getUsersByRole(role, parseInt(limit), offset);
        total = await userRepository.countByRole(role);
      } else {
        users = await userRepository.getAllUsers(parseInt(limit), offset);
        total = await userRepository.count();
      }

      res.json({
        success: true,
        data: {
          users,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit)
          }
        }
      });

    } catch (error) {
      logger.error('Get all users error', error);
      res.status(HTTP_STATUS.SERVER_ERROR).json({
        success: false,
        message: ERROR_MESSAGES.SERVER_ERROR
      });
    }
  }

  // Get user by ID
  static async getUserById(req, res) {
    try {
      const user = await userRepository.findById(req.params.id);
      
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
      logger.error('Get user by ID error', error);
      res.status(HTTP_STATUS.SERVER_ERROR).json({
        success: false,
        message: ERROR_MESSAGES.SERVER_ERROR
      });
    }
  }

  // Update user (Admin only)
  static async updateUser(req, res) {
    try {
      const { id } = req.params;
      const { first_name, last_name, phone, company_name, role, is_active } = req.body;
      const updates = {};

      if (first_name !== undefined) updates.first_name = first_name;
      if (last_name !== undefined) updates.last_name = last_name;
      if (phone !== undefined) updates.phone = phone;
      if (company_name !== undefined) updates.company_name = company_name;
      if (role !== undefined) updates.role = role;
      if (is_active !== undefined) updates.is_active = is_active;

      if (Object.keys(updates).length === 0) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          message: 'No updates provided'
        });
      }

      const updatedUser = await userRepository.update(id, updates);

      res.json({
        success: true,
        message: 'User updated successfully',
        data: updatedUser
      });

    } catch (error) {
      logger.error('Update user error', error);
      res.status(HTTP_STATUS.SERVER_ERROR).json({
        success: false,
        message: ERROR_MESSAGES.SERVER_ERROR
      });
    }
  }

  // Get user statistics (Admin only)
  static async getUserStats(req, res) {
    try {
      const stats = {
        total: await userRepository.count(),
        admin_a: await userRepository.countByRole(USER_ROLES.ADMIN_A),
        admin_b: await userRepository.countByRole(USER_ROLES.ADMIN_B),
        admin_c: await userRepository.countByRole(USER_ROLES.ADMIN_C)
      };

      res.json({
        success: true,
        data: stats
      });

    } catch (error) {
      logger.error('Get user stats error', error);
      res.status(HTTP_STATUS.SERVER_ERROR).json({
        success: false,
        message: ERROR_MESSAGES.SERVER_ERROR
      });
    }
  }
}

module.exports = UserController;