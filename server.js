const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { testConnection } = require('./db');

const authRoutes = require('./src/routes/auth.routes');
const userRoutes = require('./src/routes/user.routes');

// Initialize app
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Test database connection on startup
testConnection().then(isConnected => {
  if (isConnected) {
    console.log('🚀 Database ready for connections');
  } else {
    console.log('⚠️  Database connection issues. Server will start but DB operations may fail.');
  }
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);

// Home route
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'APRCS Authentication API',
    endpoints: {
      auth: {
        register: 'POST /api/auth/register',
        login: 'POST /api/auth/login',
        profile: 'GET /api/auth/profile'
      },
      users: 'GET /api/users (admin only)'
    }
  });
});

// Test database route
app.get('/api/test-db', async (req, res) => {
  try {
    const pool = require('./config/database').pool;
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

// Handle favicon requests
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
  🚀 APRCS Backend Server Started!
  ================================
  📍 Port: ${PORT}
  🌍 URL: http://localhost:${PORT}
  ================================
  
  📋 Available Endpoints:
  -----------------------
  GET  /                 - Welcome
  GET  /api/test-db      - Test database
  POST /api/auth/register - Register user
  POST /api/auth/login   - Login user
  GET  /api/auth/profile - Get profile (protected)
  PUT  /api/auth/profile - Update profile (protected)
  GET  /api/users        - Get all users (admin only)
  -----------------------
  `);
});