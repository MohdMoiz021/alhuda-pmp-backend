// src/controllers/authController.js
const { pool } = require('../../db');
const { generateToken, hashPassword, comparePassword } = require('../utils/auth');

// Register (Signup) User
const register = async (req, res) => {
  try {
    const { email, password, first_name, last_name, phone, company_name, role } = req.body;

    // Basic validation
    if (!email || !password || !role) {
      return res.status(400).json({
        success: false,
        message: 'Email, password, and role are required'
      });
    }

    // Check valid role
    const validRoles = ['admin_a', 'admin_b', 'admin_c'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role. Must be admin_a, admin_b, or admin_c'
      });
    }

    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'User already exists with this email'
      });
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Determine if user should be active based on role
    // admin_a (Sub Consultant) = false by default, requires approval
    // admin_b, admin_c = true by default
    const is_active = role === 'admin_a' ? false : true;

    // Insert user into database
    const newUser = await pool.query(
      `INSERT INTO users 
       (email, password_hash, first_name, last_name, phone, company_name, role, is_active) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
       RETURNING id, email, first_name, last_name, phone, company_name, role, is_active, created_at`,
      [email, hashedPassword, first_name, last_name, phone, company_name, role, is_active]
    );

    // Generate JWT token
    const token = generateToken(newUser.rows[0]);

    res.status(201).json({
      success: true,
      message: role === 'admin_a' 
        ? 'Sub Consultant application submitted successfully. Awaiting admin approval.' 
        : 'User registered successfully',
      data: {
        user: newUser.rows[0],
        token
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during registration'
    });
  }
};

// Login User
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Basic validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    // Find user by email
    const userResult = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const user = userResult.rows[0];

    // For Sub Consultants (admin_a), check if account is approved
    if (user.role === 'admin_a' && !user.is_active) {
      return res.status(403).json({
        success: false,
        message: 'Your Sub Consultant account is pending admin approval. Please wait for approval before logging in.'
      });
    }

    // Check if user is active (for other roles)
    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated. Contact administrator.'
      });
    }

    // Verify password
    const isValidPassword = await comparePassword(password, user.password_hash);
    
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Update last login
    await pool.query(
      'UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id]
    );

    // Generate JWT token
    const token = generateToken(user);

    // Remove password_hash from response
    const { password_hash, ...userWithoutPassword } = user;

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: userWithoutPassword,
        token
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
};

// Get User Profile (Protected)
const getProfile = async (req, res) => {
  try {
    const userResult = await pool.query(
      'SELECT id, email, first_name, last_name, phone, company_name, role, is_active, created_at FROM users WHERE id = $1',
      [req.user.id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: userResult.rows[0]
    });

  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// Update User Profile (Protected)
const updateProfile = async (req, res) => {
  try {
    const { first_name, last_name, phone, company_name } = req.body;
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (first_name !== undefined) {
      updates.push(`first_name = $${paramCount}`);
      values.push(first_name);
      paramCount++;
    }

    if (last_name !== undefined) {
      updates.push(`last_name = $${paramCount}`);
      values.push(last_name);
      paramCount++;
    }

    if (phone !== undefined) {
      updates.push(`phone = $${paramCount}`);
      values.push(phone);
      paramCount++;
    }

    if (company_name !== undefined) {
      updates.push(`company_name = $${paramCount}`);
      values.push(company_name);
      paramCount++;
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No updates provided'
      });
    }

    // Add user id to values
    values.push(req.user.id);

    const updateQuery = `
      UPDATE users 
      SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $${paramCount}
      RETURNING id, email, first_name, last_name, phone, company_name, role, is_active, updated_at
    `;

    const result = await pool.query(updateQuery, values);

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// Get all users (Only for admin_c)
const getAllUsers = async (req, res) => {
  try {
    // Check if the current user is admin_c
    if (req.user.role !== 'admin_c') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only admin_c can view all users.'
      });
    }

    // Fetch all users with all fields except password_hash
    const usersResult = await pool.query(
      `SELECT 
        id, 
        email, 
        first_name, 
        last_name, 
        phone, 
        company_name, 
        role, 
        is_active,
        created_at,
        updated_at
       FROM users 
       ORDER BY created_at DESC`
    );

    res.json({
      success: true,
      count: usersResult.rows.length,
      data: usersResult.rows
    });

  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching users'
    });
  }
};

// Get user by ID (Only for admin_c)
const getUserById = async (req, res) => {
  try {
    // Check if the current user is admin_c
    if (req.user.role !== 'admin_c') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only admin_c can view user details.'
      });
    }

    const { id } = req.params;

    // Fetch user by ID with all fields except password_hash
    const userResult = await pool.query(
      `SELECT 
        id, 
        email, 
        first_name, 
        last_name, 
        phone, 
        company_name, 
        role, 
        is_active,
        created_at,
        updated_at
       FROM users 
       WHERE id = $1`,
      [id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: userResult.rows[0]
    });

  } catch (error) {
    console.error('Get user by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching user details'
    });
  }
};

// Update user status (Approve/Deactivate - Only for admin_c)
const updateUserStatus = async (req, res) => {
  try {
    // Check if the current user is admin_c
    if (req.user.role !== 'admin_c') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only admin_c can update user status.'
      });
    }

    const { id } = req.params;
    const { is_active } = req.body;

    // Validate input
    if (typeof is_active !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'is_active must be a boolean value'
      });
    }

    // Check if user exists
    const userCheck = await pool.query(
      'SELECT id, role FROM users WHERE id = $1',
      [id]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = userCheck.rows[0];

    // Update user status
    const result = await pool.query(
      `UPDATE users 
       SET is_active = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, email, first_name, last_name, phone, company_name, role, is_active, updated_at`,
      [is_active, id]
    );

    const action = is_active ? 'approved' : 'deactivated';
    
    res.json({
      success: true,
      message: `User ${action} successfully`,
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Update user status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating user status'
    });
  }
};

// Get pending Sub Consultants (admin_a with is_active = false)
const getPendingSubConsultants = async (req, res) => {
  try {
    // Check if the current user is admin_c
    if (req.user.role !== 'admin_c') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only admin_c can view pending applications.'
      });
    }

    // Fetch pending Sub Consultants
    const pendingUsers = await pool.query(
      `SELECT 
        id, 
        email, 
        first_name, 
        last_name, 
        phone, 
        company_name, 
        role, 
        is_active,
        created_at,
        updated_at
       FROM users 
       WHERE role = 'admin_a' AND is_active = false
       ORDER BY created_at DESC`
    );

    res.json({
      success: true,
      count: pendingUsers.rows.length,
      data: pendingUsers.rows
    });

  } catch (error) {
    console.error('Get pending sub consultants error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching pending applications'
    });
  }
};

// Delete user (Only for admin_c)
const deleteUser = async (req, res) => {
  try {
    // Check if the current user is admin_c
    if (req.user.role !== 'admin_c') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only admin_c can delete users.'
      });
    }

    const { id } = req.params;

    // Check if user exists
    const userCheck = await pool.query(
      'SELECT id, role FROM users WHERE id = $1',
      [id]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Prevent deleting yourself
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'You cannot delete your own account'
      });
    }

    // Delete user
    await pool.query('DELETE FROM users WHERE id = $1', [id]);

    res.json({
      success: true,
      message: 'User deleted successfully'
    });

  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while deleting user'
    });
  }
};

// Update module.exports at the end of the file
module.exports = { 
  register, 
  login, 
  getProfile, 
  updateProfile, 
  getAllUsers, 
  getUserById,
  updateUserStatus,
  getPendingSubConsultants,
  deleteUser
};