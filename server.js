const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const {pool,testConnection} = require('./db');
require('dotenv').config();
const app = express();

// Middleware
app.use(cors());
app.use(express.json());


// ======================
// HELPER FUNCTIONS
// ======================


// Test database connection on startup
testConnection().then(isConnected => {
  if (isConnected) {
    console.log('🚀 Database ready for connections');
  } else {
    console.log('⚠️  Database connection issues. Server will start but DB operations may fail.');
  }
});

// Generate JWT token
const generateToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.first_name || user.email.split('@')[0]
    },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
};

// Hash password
const hashPassword = async (password) => {
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(password, salt);
};

// Compare password
const comparePassword = async (password, hashedPassword) => {
  return await bcrypt.compare(password, hashedPassword);
};

// Authentication middleware - MAKE SURE THIS EXISTS!
const authenticate = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Access denied. No token provided.'
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid token.'
    });
  }
};

// ======================
// API ENDPOINTS
// ======================

// 1. HOME ROUTE
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'APRCS Authentication API',
    endpoints: {
      register: 'POST /api/register',
      login: 'POST /api/login',
      profile: 'GET /api/profile',
      test: 'GET /api/test-db'
    }
  });
});

// 2. TEST DATABASE CONNECTION
app.get('/api/test-db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() as time');
    res.json({
      success: true,
      message: 'Database connected successfully',
      time: result.rows[0].time
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Database connection failed',
      error: error.message
    });
  }
});

// 3. REGISTER (SIGNUP) USER
app.post('/api/register', async (req, res) => {
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

    // Insert user into database
    const newUser = await pool.query(
      `INSERT INTO users 
       (email, password_hash, first_name, last_name, phone, company_name, role) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       RETURNING id, email, first_name, last_name, phone, company_name, role, is_active, created_at`,
      [email, hashedPassword, first_name, last_name, phone, company_name, role]
    );

    // Generate JWT token
    const token = generateToken(newUser.rows[0]);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
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
});

// 4. LOGIN USER
app.post('/api/login', async (req, res) => {
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

    // Check if user is active
    if (!user.is_active) {
      return res.status(401).json({
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

    // Update last login (if you add that field later)
    // For now, just update the updated_at
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
});

// 5. GET USER PROFILE (Protected)
app.get('/api/profile', authenticate, async (req, res) => {
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
});

// 6. UPDATE USER PROFILE (Protected)
app.put('/api/profile', authenticate, async (req, res) => {
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
});

// 7. GET ALL USERS (Admin only - optional)
app.get('/api/users', authenticate, async (req, res) => {
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
});

// Handle favicon requests (to avoid 404 errors)
app.get('/favicon.ico', (req, res) => res.status(204).end());

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.url}`
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error'
  });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`
  🚀 Simple Auth Server Started!
  ==============================
  📍 Port: ${PORT}
  🌍 URL: http://localhost:${PORT}
  🗄️ Database: ${process.env.DB_HOST}
  ==============================
  
  📋 Available Endpoints:
  -----------------------
  GET  /               - Welcome
  GET  /api/test-db    - Test database
  POST /api/register   - Register user
  POST /api/login      - Login user
  GET  /api/profile    - Get profile (protected)
  PUT  /api/profile    - Update profile (protected)
  GET  /api/users      - Get all users (admin only)
  -----------------------
  `);
});