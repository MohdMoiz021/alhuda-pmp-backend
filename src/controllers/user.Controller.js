// src/controllers/userController.js
const { pool } = require('../../db');

// Get All Users (Admin only)
const getAllUsers = async (req, res) => {
  try {
    // Check if user is admin_c (management)
    if (req.user.role !== 'admin_c') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin privileges required.'
      });
    }

    const users = await pool.query(
      'SELECT id, email, first_name, last_name, phone, company_name, role, is_active, created_at FROM users ORDER BY created_at DESC'
    );

    res.json({
      success: true,
      data: users.rows
    });

  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

module.exports = { getAllUsers };